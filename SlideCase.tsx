import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useLoader, useThree, useFrame } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { slideBus } from './slideBus'
import { highlightBus } from './highlightBus'

/**
 * Estuche de portaobjetos: modelo real "Microscope Slides & Case" por Jules
 * (Sketchfab, CC-BY-NC-4.0) — dar crédito si se publica. Vive en
 * ./modelos/slides/slides.gltf (+ scene.bin + textures/).
 *
 * Interacción: un clic sobre el estuche "toma" un portaobjetos, que queda
 * flotando enfrente de la cámara mientras te movés. El siguiente clic sobre
 * cualquier superficie real (mostrador, microscopio, el propio estuche…) lo
 * suelta ahí, apoyado según la normal de esa cara.
 *
 * Nota: el .gltf no trae portaobjetos sueltos (solo el estuche cerrado con
 * la pila modelada en bloque), así que el que se toma es una losa propia
 * generada acá — 75 x 25 x 2 mm con banda esmerilada, a escala del cuarto.
 */

// El microscopio se apoya en el mostrador con la base en y=1.3, centrado en
// (x=0.39, z=1.7) — ver Microscope.tsx. El estuche va al lado, desplazado en X.
const CASE_POS = new THREE.Vector3(0.30 + 0.28, 1.3, 1.70)
const CASE_TARGET = 0.2 // dimensión mayor del estuche, en metros (~caja de portaobjetos)

// Pose fija del portaobjetos cuando se apoya en la platina del microscopio
// (Microscope.tsx: base en y≈1.28, centrado en x≈0.39, z≈1.7). Aproximada —
// ajustable a ojo con la tecla P si no cae justo sobre la platina.
const SCOPE_STAGE_POS = new THREE.Vector3(0.39, 1.46, 1.73)
const SCOPE_STAGE_QUAT = new THREE.Quaternion()

// Pose del portaobjetos "en la mano", enfrente de la cámara. Se llega a ella
// por lerp/slerp (no de golpe) para que al sacarlo de un frasco el regreso a
// la mano se vea suave. Temporales de módulo para no crear objetos por frame.
const HELD_OFFSET = new THREE.Vector3(0.1, -0.12, -0.38)
const HELD_TILT = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, 0, 0))
  .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.15)))
const _hp = new THREE.Vector3()
const _hq = new THREE.Quaternion()

const SLIDE_LEN = 0.075
const SLIDE_WID = 0.025
const SLIDE_THK = 0.002

type SlideProps = React.ComponentProps<'group'> & {
  /** Muestra el puntito morado del centro: la sección teñida con H&E. */
  stained?: boolean
}

/** Una losa de portaobjetos: vidrio translúcido + banda esmerilada en un
 *  extremo, y (una vez teñido) una gota morada de muestra en el centro. */
const Slide = forwardRef<THREE.Group, SlideProps>(({ stained, ...props }, ref) => (
  <group ref={ref} {...props}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={[SLIDE_LEN, SLIDE_THK, SLIDE_WID]} />
      <meshPhysicalMaterial
        color="#dCEAF2"
        roughness={0.08}
        metalness={0}
        transmission={0.6}
        thickness={SLIDE_THK}
        transparent
        opacity={0.8}
      />
    </mesh>
    <mesh position={[-(SLIDE_LEN / 2) + 0.009, 0, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.018, SLIDE_THK * 1.05, SLIDE_WID]} />
      <meshStandardMaterial color="#eef0f2" roughness={0.9} metalness={0} />
    </mesh>
    <mesh position={[0, 0, 0]} visible={!!stained} castShadow>
      <cylinderGeometry args={[0.0045, 0.0045, SLIDE_THK * 1.6, 20]} />
      <meshStandardMaterial color="#7a2ea0" roughness={0.65} metalness={0} />
    </mesh>
  </group>
))
Slide.displayName = 'Slide'

interface Placed {
  id: number
  pos: THREE.Vector3
  quat: THREE.Quaternion
  stained: boolean
  onScope: boolean // apoyado en la platina del microscopio
}

export function SlideCase() {
  const { camera, gl, scene } = useThree()
  const gltf = useLoader(GLTFLoader, './modelos/slides/slides.gltf')

  const caseRef = useRef<THREE.Object3D>(null!)
  const heldRef = useRef<THREE.Group>(null!)
  const holdingRef = useRef(false)
  const [holding, setHolding] = useState(false)
  const [placed, setPlaced] = useState<Placed[]>([])
  // El portaobjetos en mano ya pasó por H&E → lleva la gota morada.
  const [stained, setStained] = useState(false)
  const stainedRef = useRef(false)

  const raycaster = useRef(new THREE.Raycaster())
  const downPt = useRef({ x: 0, y: 0 })
  const nextId = useRef(0)

  // Estuche: misma lógica de normalización que Microscope.tsx — escala por la
  // dimensión mayor y apoya en el mostrador (min.y -> CASE_POS.y).
  const caseModel = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    const rawSize = new THREE.Box3().setFromObject(cloned).getSize(new THREE.Vector3())
    const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1
    cloned.scale.multiplyScalar(CASE_TARGET / maxDim)

    const box = new THREE.Box3().setFromObject(cloned)
    const center = box.getCenter(new THREE.Vector3())
    cloned.position.x += CASE_POS.x - center.x
    cloned.position.z += CASE_POS.z - center.z
    cloned.position.y += CASE_POS.y - box.min.y
    return cloned
  }, [gltf])

  // Le dice al agente (via highlightBus) donde esta el estuche, para
  // que la tool `resaltar_objeto` lo pueda senalar sin saber nada de
  // Three.js.
  useEffect(() => {
    highlightBus.targets.estuche = caseRef.current
    return () => { highlightBus.targets.estuche = null }
  }, [caseModel])

  // Un solo manejador de clic hace todo el raycasting (tomar / soltar), así
  // no compite con el clic-y-arrastra para mirar de PlayerControls.
  useEffect(() => {
    const canvas = gl.domElement
    const onDown = (e: MouseEvent) => { downPt.current = { x: e.clientX, y: e.clientY } }

    const onClick = (e: MouseEvent) => {
      // Si el puntero se movió, fue un arrastre para mirar: ignorar.
      if (Math.hypot(e.clientX - downPt.current.x, e.clientY - downPt.current.y) > 6) return

      // Si <JarRow> se apropió del portaobjetos para sumergirlo, ese clic es
      // suyo: no lo soltamos ni tomamos otro.
      if (slideBus.claimedByJar !== null) return

      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      camera.updateMatrixWorld()
      raycaster.current.setFromCamera(ndc, camera)

      if (holdingRef.current) {
        // Soltar: primer impacto que no sea el propio portaobjetos en mano.
        const hits = raycaster.current.intersectObjects(scene.children, true)
        const hit = hits.find((h) => {
          for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
            if (o === heldRef.current) return false
          }
          return true
        })
        if (!hit) return // clic al vacío: se sigue sosteniendo

        // Si lo que hay delante del cursor es un frasco, ese clic es de
        // <JarRow> (meter / sacar el portaobjetos): no lo soltamos, y no
        // seguimos "de largo" hasta el mostrador que haya detrás.
        for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
          if (o.userData?.isJar) return
        }

        // ¿Soltando sobre el microscopio? → va a la platina, en pose fija, y
        // queda habilitado abrir la imagen al hacer clic en el microscopio.
        for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
          if (o.userData?.isScope) {
            setPlaced((p) => [
              ...p,
              {
                id: nextId.current++,
                pos: SCOPE_STAGE_POS.clone(),
                quat: SCOPE_STAGE_QUAT.clone(),
                stained: stainedRef.current,
                onScope: true,
              },
            ])
            slideBus.onScope = true
            holdingRef.current = false
            setHolding(false)
            return
          }
        }

        const pos = hit.point.clone()
        const quat = new THREE.Quaternion()
        if (hit.face) {
          const n = hit.face.normal.clone()
            .transformDirection(hit.object.matrixWorld)
            .normalize()
          quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
          pos.addScaledVector(n, SLIDE_THK / 2 + 0.0002)
        }
        setPlaced((p) => [
          ...p,
          { id: nextId.current++, pos, quat, stained: stainedRef.current, onScope: false },
        ])
        holdingRef.current = false
        setHolding(false)
        return
      }

      // Nada en mano: ¿se clicó el estuche? Se toma un portaobjetos nuevo,
      // limpio (sin teñir), y se retira el que hubiera en la platina.
      if (raycaster.current.intersectObject(caseRef.current, true).length > 0) {
        holdingRef.current = true
        setHolding(true)
        slideBus.stained = false
        stainedRef.current = false
        setStained(false)
        slideBus.onScope = false
        setPlaced((p) => p.filter((s) => !s.onScope))
      }
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('click', onClick)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('click', onClick)
    }
  }, [gl, camera, scene])

  // Mientras se sostiene, el portaobjetos flota enfrente de la cámara.
  useFrame(() => {
    // Mantiene el puente al día para <JarRow>.
    slideBus.group = heldRef.current ?? null
    slideBus.held = holdingRef.current
    // <JarRow> marca el teñido al sacar el portaobjetos de H&E; lo reflejamos
    // en estado (una sola vez) para que aparezca la gota morada.
    if (slideBus.stained && !stainedRef.current) {
      stainedRef.current = true
      setStained(true)
    }
    // Mientras <JarRow> lo tiene sumergido en un frasco, es él quien lo
    // mueve; nosotros no.
    if (slideBus.claimedByJar !== null) return
    if (!holdingRef.current || !heldRef.current) return
    _hp.copy(HELD_OFFSET)
    camera.localToWorld(_hp)
    _hq.copy(camera.quaternion).multiply(HELD_TILT)
    // lerp/slerp: al soltarlo de un frasco vuelve a la mano con transición.
    heldRef.current.position.lerp(_hp, 0.35)
    heldRef.current.quaternion.slerp(_hq, 0.35)
  })

  return (
    <>
      <primitive object={caseModel} ref={caseRef} />
      <Slide ref={heldRef} visible={holding} stained={stained} />
      {placed.map((p) => (
        <Slide key={p.id} position={p.pos} quaternion={p.quat} stained={p.stained} />
      ))}
    </>
  )
}
