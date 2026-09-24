import { useEffect, useMemo, useRef } from 'react'
import { useLoader, useThree, useFrame } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { slideBus } from './slideBus'
import { highlightBus } from './highlightBus'
import { agentNotices } from './agentNotices'
import { examBus } from './examBus'

// Misma altura de mostrador que ya usamos para el microscopio y el estuche
// de portaobjetos (Microscope.tsx / SlideCase.tsx).
const COUNTER_Y = 1.3
// Punto de partida de la fila (ajustar con la tecla P). La fila se arma en
// coordenadas locales centradas en 0 y luego el grupo entero se coloca y se
// gira, así que este vector es solo el ancla del primer frasco.
const ROW_START = new THREE.Vector3(0.70 - 0.6, COUNTER_Y, 0.9)
const SPACING = 0.14 // separación entre frascos
const JAR_TARGET = 0.16 // altura objetivo de cada frasco, en metros
const ROW_ANGLE = Math.PI / 2 // 90° a la derecha (horario visto desde arriba)

const LIQUID_COLORS = [
  '#cfe3ee', // translúcido 1
  '#d8ecec', // translúcido 2
  '#e6f0d8', // translúcido 3
  '#f0e6d0', // translúcido 4
  '#e0d8ec', // translúcido 5
  '#d0e6f0', // translúcido 6
  '#3a1750', // el último: morado oscuro (hematoxilina)
]

// Qué dice el globo al pasar el mouse por cada frasco: la serie de alcoholes
// en orden descendente y, al final, el frasco de tinción. El orden coincide
// con LIQUID_COLORS y con los 7 frascos de la fila.
const JAR_LABELS = [
  'Alcohol 100%',
  'Alcohol 95%',
  'Alcohol 90%',
  'Alcohol 85%',
  'Alcohol 80%',
  'Alcohol 70%',
  'H&E',
]

// Dónde queda la tapa cuando el frasco está "abierto": a mano izquierda,
// frente a la cámara — espejo del portaobjetos en mano de Slide.tsx, que va
// a la derecha en (0.1, -0.12, -0.38).
const LID_HOLD_OFFSET = new THREE.Vector3(-0.13, -0.11, -0.32)

// Temporales de módulo para no crear objetos por frame.
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.3, 0.2, 0))
// Portaobjetos sumergido: parado, eje largo hacia abajo (rotZ -90°), y con el
// giro de la fila aplicado para que la cara mire a lo largo del mostrador.
const SLIDE_DIP_QUAT = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(0, ROW_ANGLE, 0))
  .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)))

interface JarInstance {
  model: THREE.Object3D
  lid: THREE.Object3D | null
  localX: number
  liquidHeight: number
  liquidRadius: number
  liquidY: number
  color: string
  opaque: boolean
}

interface JarRowProps {
  count?: number
  /** Aviso a <App> de qué globo mostrar (o null al salir del frasco). */
  onTip?: (tip: { label: string; x: number; y: number } | null) => void
}

export function JarRow({ count = 7, onTip }: JarRowProps) {
  const { camera, gl, scene } = useThree()
  const gltf = useLoader(GLTFLoader, './modelos/glass_jar/jar.gltf')

  const jars = useMemo<JarInstance[]>(() => {
    const instances: JarInstance[] = []

    for (let i = 0; i < count; i++) {
      const localX = (i - (count - 1) / 2) * SPACING

      const cloned = gltf.scene.clone(true)
      cloned.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
        // Marca para que <SlideCase> sepa "esto es un frasco, lo maneja JarRow".
        child.userData.isJar = true
      })
      cloned.userData.isJar = true
      cloned.userData.jarIndex = i
      cloned.updateMatrixWorld(true)

      // El modelo trae el cuerpo (Object_2) y la tapa (Object_3) como piezas
      // separadas, con la tapa modelada a un lado del frasco, no encima. La
      // reubicamos centrada sobre la boca.
      //
      // Clave del arreglo anterior: `lid.position` es RELATIVO al origen de
      // la malla de la tapa (que ya trae un offset horneado en los vértices),
      // así que copiar ahí una posición absoluta la dejaba "zafada". Ahora
      // calculamos el DESPLAZAMIENTO entre el centro actual de la tapa y el
      // destino, y ese delta (rotado al espacio del padre) se suma a la
      // posición que ya tenía.
      const jarBody = cloned.getObjectByName('Object_2') ?? null
      const lid = cloned.getObjectByName('Object_3') ?? null
      if (jarBody && lid && lid.parent) {
        const jarBox = new THREE.Box3().setFromObject(jarBody)
        const lidBox = new THREE.Box3().setFromObject(lid)
        const lidThickness = lidBox.max.y - lidBox.min.y // eje fino de la tapa = Y (tras la matriz raíz)
        const lidCenter = lidBox.getCenter(new THREE.Vector3())

        const target = new THREE.Vector3(
          (jarBox.min.x + jarBox.max.x) / 2,
          jarBox.max.y + lidThickness / 2 - lidThickness * 0.35, // asentada sobre el borde
          (jarBox.min.z + jarBox.max.z) / 2,
        )
        const deltaWorld = target.sub(lidCenter)
        // El padre solo tiene rotación (sin escala): basta rotar el delta por
        // el inverso de su cuaternión de mundo para pasarlo a espacio local.
        const invParentQuat = lid.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        lid.position.add(deltaWorld.applyQuaternion(invParentQuat))
        cloned.updateMatrixWorld(true)
      }

      // Normaliza el tamaño del frasco (por su dimensión mayor) y lo apoya
      // sobre el plano local y=0 (el grupo contenedor ya está a COUNTER_Y).
      const rawSize = new THREE.Box3().setFromObject(cloned).getSize(new THREE.Vector3())
      const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1
      cloned.scale.multiplyScalar(JAR_TARGET / maxDim)
      cloned.updateMatrixWorld(true)

      const box = new THREE.Box3().setFromObject(cloned)
      const center = box.getCenter(new THREE.Vector3())
      cloned.position.x += localX - center.x
      cloned.position.z += 0 - center.z
      cloned.position.y += 0 - box.min.y
      cloned.updateMatrixWorld(true)

      // Guarda la pose "en casa" de la tapa (sobre la boca) para poder
      // devolverla ahí al cerrar el frasco. Es local a su padre original.
      if (lid) {
        lid.userData.homeParent = lid.parent
        lid.userData.homePos = lid.position.clone()
        lid.userData.homeQuat = lid.quaternion.clone()
        lid.userData.homeScale = lid.scale.clone()
      }

      // Dimensiones del líquido a partir del cuerpo del frasco ya escalado y
      // posicionado — un cilindro que llena buena parte del interior. Todo en
      // el mismo espacio local que usa el <mesh> de abajo.
      const finalJarBox = jarBody
        ? new THREE.Box3().setFromObject(jarBody)
        : box
      const jarSize = finalJarBox.getSize(new THREE.Vector3())
      const liquidRadius = Math.min(jarSize.x, jarSize.z) * 0.38
      const liquidHeight = jarSize.y * 0.62
      const liquidY = finalJarBox.min.y + jarSize.y * 0.08 + liquidHeight / 2

      instances.push({
        model: cloned,
        lid,
        localX,
        liquidHeight,
        liquidRadius,
        liquidY,
        color: LIQUID_COLORS[i] ?? LIQUID_COLORS[LIQUID_COLORS.length - 1],
        opaque: i === count - 1,
      })
    }
    return instances
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, count])

  // El grupo se ancla en el centro de la fila (para que el giro pivote ahí) y
  // a la altura del mostrador.
  const centerX = ROW_START.x + ((count - 1) * SPACING) / 2

  const topRef = useRef<THREE.Group>(null!)
  const jarsRef = useRef(jars)
  jarsRef.current = jars

  // Registra cada frasco individualmente ("frasco-0", "frasco-1", ...)
  // para que el agente pueda resaltar uno especifico sin saber como
  // estan armados sus meshes por dentro.
  useEffect(() => {
    jars.forEach((jar, i) => { highlightBus.targets[`frasco-${i}`] = jar.model })
    return () => {
      jars.forEach((_, i) => { highlightBus.targets[`frasco-${i}`] = null })
    }
  }, [jars])

  // Estado de interacción — solo refs, ningún re-render de React hace falta:
  // las tapas se mueven mutando el objeto THREE directamente en useFrame.
  const activeJarRef = useRef<number | null>(null) // frasco con la tapa abierta
  const dippedRef = useRef(false) // ¿el portaobjetos está sumergido (vs. levantado)?
  // Único frasco que se puede abrir ahora mismo: obliga a recorrer la fila
  // en orden (100% → 95% → … → 70% → H&E), sin saltarse ni volver atrás.
  const nextJarRef = useRef(0)

  // Avisa el error EN EL CHAT (voz de Glía, sin pasar por el modelo) y
  // apunta/lleva la cámara a lo que hay que hacer para corregirlo — ver
  // agentNotices.ts. En modo prueba (examBus.active) esto se calla del
  // todo: el estudiante tiene que resolverlo solo, sin correcciones.
  const hint = (msg: string, pointAt: string) => {
    if (examBus.active) return
    agentNotices.send(msg, pointAt)
  }

  // ── Cerrar el frasco activo: la tapa vuelve a su boca y, si este frasco
  //    tenía el portaobjetos, se lo devolvemos a <SlideCase>.
  function closeActiveJar() {
    const cur = activeJarRef.current
    if (cur === null) return
    // Si estaba sumergido en H&E, el portaobjetos sale teñido.
    if (dippedRef.current && cur === count - 1) slideBus.stained = true
    if (slideBus.claimedByJar === cur) slideBus.claimedByJar = null // SlideCase retoma el portaobjetos
    dippedRef.current = false
    // OJO: nextJarRef NO se toca acá. Solo avanza cuando el portaobjetos de
    // verdad entra y sale de la solución (ver handleJarClick) — abrir un
    // frasco y cerrarlo con Escape sin haberlo metido no cuenta como
    // "hecho", así que no hay nada que retroceder ni que confirmar aquí.
    const lid = jarsRef.current[cur]?.lid
    if (lid && lid.userData.homeParent) {
      ;(lid.userData.homeParent as THREE.Object3D).add(lid)
      lid.position.copy(lid.userData.homePos as THREE.Vector3)
      lid.quaternion.copy(lid.userData.homeQuat as THREE.Quaternion)
      lid.scale.copy(lid.userData.homeScale as THREE.Vector3)
    }
    activeJarRef.current = null
  }

  // ── Clic sobre el frasco i. Secuencia guiada:
  //    1. Tomá un portaobjetos del estuche.
  //    2. Clic en el frasco que toca (en orden, 100% → … → H&E): abre la
  //       tapa (queda a mano izquierda) y el portaobjetos pasa a tu control.
  //    3. Clic de nuevo en ese frasco: mete el portaobjetos en la solución.
  //    4. Otro clic: lo saca. Meté y sacá las veces que quieras.
  //    5. Clic en el frasco siguiente: cierra este y abre ese.
  //    (tecla Escape: cierra el frasco activo y suelta el portaobjetos)
  function handleJarClick(i: number) {
    // Frasco ya abierto: alternar meter / sacar (o tapar si no traés nada).
    if (activeJarRef.current === i) {
      if (slideBus.held && slideBus.group) {
        dippedRef.current = !dippedRef.current // meter ⇄ sacar
        // Solo mientras está DENTRO lo controla JarRow; al sacarlo, el control
        // vuelve a <SlideCase> (que lo lleva de vuelta a la mano) — así podés
        // alejarte al microscopio sin que quede "trabado" en el frasco.
        slideBus.claimedByJar = dippedRef.current ? i : null
        if (!dippedRef.current) {
          // Completó un ciclo de meter/sacar EN ESTE frasco: recién ahora
          // "pasó" por él de verdad (antes, esto se marcaba con solo abrir
          // la tapa, sin haber metido el portaobjetos — reportado como bug).
          // Math.max, no asignación directa: por si closeActiveJar() se
          // llama después con un frasco anterior y no debe retroceder esto.
          nextJarRef.current = Math.max(nextJarRef.current, i + 1)
          // Al SACARLO del frasco de H&E queda teñido: sale con la gota morada.
          if (i === count - 1) slideBus.stained = true
          // Modo prueba: registra el orden REAL (aunque esté mal) para
          // calificar la fidelidad al proceso al final — ver examBus.ts.
          if (examBus.active) examBus.log.push(i)
        }
      } else {
        closeActiveJar()
      }
      return
    }

    // Abrir un frasco distinto: hace falta portaobjetos en mano y respetar
    // el orden de la fila.
    if (!slideBus.held || !slideBus.group) {
      hint('Antes necesitas un portaobjetos en la mano — vamos al estuche.', 'estuche')
      return
    }
    // En modo prueba no se obliga el orden: el estudiante es libre de
    // equivocarse (eso mismo es lo que se califica al final).
    if (!examBus.active && i !== nextJarRef.current) {
      hint(
        `Ese todavía no toca. Sigamos el orden: te llevo al frasco de ${JAR_LABELS[nextJarRef.current] ?? '—'}.`,
        `frasco-${nextJarRef.current}`,
      )
      return
    }

    closeActiveJar() // cierra el frasco anterior de la fila
    const lid = jarsRef.current[i]?.lid
    if (lid) scene.attach(lid) // saca la tapa del frasco preservando su pose de mundo
    activeJarRef.current = i
    dippedRef.current = false
    // nextJarRef NO avanza acá con solo abrir -- avanza cuando de verdad
    // metes y sacas el portaobjetos (ver el toggle de arriba). Así, abrir un
    // frasco y saltar al siguiente sin haberlo usado ya no cuenta como
    // "hecho".
    // El portaobjetos sigue en la mano (control de <SlideCase>) hasta que lo
    // metas con otro clic.
  }

  // Los listeners se registran una sola vez; llaman siempre a la última
  // versión de estas funciones vía refs.
  const handlerRef = useRef(handleJarClick)
  handlerRef.current = handleJarClick
  const closeRef = useRef(closeActiveJar)
  closeRef.current = closeActiveJar

  // Raycasting manual para el clic (igual que SlideCase) — así no compite con
  // el clic-y-arrastra para mirar de PlayerControls.
  useEffect(() => {
    const canvas = gl.domElement
    const downPt = { x: 0, y: 0 }
    const raycaster = new THREE.Raycaster()

    const onDown = (e: MouseEvent) => { downPt.x = e.clientX; downPt.y = e.clientY }
    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 6) return
      if (!topRef.current) return

      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      camera.updateMatrixWorld()
      raycaster.setFromCamera(ndc, camera)

      const hits = raycaster.intersectObject(topRef.current, true)
      let idx: number | null = null
      if (hits.length) {
        for (let o: THREE.Object3D | null = hits[0].object; o; o = o.parent) {
          if (typeof o.userData?.jarIndex === 'number') { idx = o.userData.jarIndex; break }
        }
      }
      if (idx !== null) { handlerRef.current(idx); return }

      // El clic no fue a un frasco. Si apuntaste al microscopio y hay un
      // frasco abierto, ciérralo (el portaobjetos vuelve a la mano) para que
      // el próximo clic lo pueda apoyar en la platina.
      if (activeJarRef.current === null) return
      const solid = raycaster
        .intersectObjects(scene.children, true)
        .find((h) => {
          for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
            if (o === slideBus.group) return false // ignora el portaobjetos en mano
          }
          return true
        })
      if (!solid) return
      for (let o: THREE.Object3D | null = solid.object; o; o = o.parent) {
        if (o.userData?.isScope) { closeRef.current(); break }
      }
    }

    // Escape: cierra el frasco activo y suelta el portaobjetos (vuelve a la
    // mano). Mismo espíritu que la tecla P de App.tsx.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [gl, camera, scene])

  // Al desmontar, devuelve cualquier tapa que haya quedado "en la mano".
  useEffect(() => {
    const s = scene
    return () => {
      jarsRef.current.forEach((j) => {
        const lid = j.lid
        if (lid && lid.parent === s && lid.userData.homeParent) {
          ;(lid.userData.homeParent as THREE.Object3D).add(lid)
          lid.position.copy(lid.userData.homePos as THREE.Vector3)
          lid.quaternion.copy(lid.userData.homeQuat as THREE.Quaternion)
          lid.scale.copy(lid.userData.homeScale as THREE.Vector3)
        }
      })
      slideBus.claimedByJar = null
    }
  }, [scene])

  // Anima la tapa abierta (hacia la mano izquierda) y, si corresponde, el
  // portaobjetos hundiéndose en la solución.
  useFrame(() => {
    const i = activeJarRef.current
    if (i === null) return
    const jar = jarsRef.current[i]
    if (!jar) return

    // Si el portaobjetos ya no está en la mano (lo apoyaste en el microscopio
    // o en el mostrador) y no está sumergido acá, cerrá el frasco que quedó
    // abierto.
    if (!slideBus.held && slideBus.claimedByJar === null) {
      closeActiveJar()
      return
    }

    // La tapa abierta sigue a la cámara, a mano izquierda.
    if (jar.lid) {
      _v.copy(LID_HOLD_OFFSET)
      camera.localToWorld(_v)
      jar.lid.position.lerp(_v, 0.2)
      _q.copy(camera.quaternion).multiply(_tilt)
      jar.lid.quaternion.slerp(_q, 0.2)
    }

    // Mientras esté SUMERGIDO en este frasco, JarRow lo lleva por lerp al
    // punto de la solución. Al sacarlo, el control vuelve a <SlideCase>.
    if (slideBus.claimedByJar === i && dippedRef.current && slideBus.group && topRef.current) {
      _v.set(jar.localX, jar.liquidY + jar.liquidHeight / 2 - 0.015, 0)
      topRef.current.localToWorld(_v)
      slideBus.group.position.lerp(_v, 0.15)
      slideBus.group.quaternion.slerp(SLIDE_DIP_QUAT, 0.15)
    }
  })

  const emitTip = (i: number, e: { nativeEvent: PointerEvent }) => {
    onTip?.({ label: JAR_LABELS[i] ?? '', x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }

  return (
    <group ref={topRef} position={[centerX, COUNTER_Y, ROW_START.z]} rotation={[0, ROW_ANGLE, 0]}>
      {jars.map((jar, i) => (
        <group
          key={i}
          onPointerOver={(e) => {
            e.stopPropagation()
            gl.domElement.style.cursor = 'pointer'
            emitTip(i, e)
          }}
          onPointerMove={(e) => {
            e.stopPropagation()
            emitTip(i, e)
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            gl.domElement.style.cursor = 'grab'
            onTip?.(null)
          }}
        >
          <primitive object={jar.model} />
          <mesh position={[jar.localX, jar.liquidY, 0]} userData={{ jarIndex: i, isJar: true }}>
            <cylinderGeometry args={[jar.liquidRadius, jar.liquidRadius, jar.liquidHeight, 20]} />
            <meshPhysicalMaterial
              color={jar.color}
              transparent={!jar.opaque}
              opacity={jar.opaque ? 1 : 0.55}
              roughness={0.15}
              transmission={jar.opaque ? 0 : 0.35}
              thickness={jar.liquidRadius}
            />
          </mesh>
        </group>
      ))}
      {/* Malla invisible que cubre TODA la fila (con margen), un poco detrás
          de los frascos (local z negativo = más lejos de quien se acerca,
          ver approachPoses.ts: se para del lado +Z local). Un clic que
          apunta cerca de un frasco pero no le pega exactamente a su malla
          (entre dos frascos, al borde) seguía de largo hasta el mostrador —
          y <SlideCase>, que también escucha clicks, lo interpretaba como
          "soltar el portaobjetos aquí" antes de que este componente
          tuviera oportunidad de abrir el frasco correcto. Como esta malla
          también lleva isJar=true, <SlideCase> la reconoce como "zona de
          frascos, no soltar" aunque el clic no haya caído en un frasco
          específico — un casi-acierto ahora no hace nada, en vez de tirar
          el portaobjetos silenciosamente. Al estar detrás de los frascos,
          un clic que sí le pegue de lleno a uno sigue resolviendo ESE
          frasco (está más cerca de la cámara que esta malla). */}
      <mesh position={[0, 0.12, -0.06]} userData={{ isJar: true }}>
        <planeGeometry args={[1.2, 0.24]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  )
}
