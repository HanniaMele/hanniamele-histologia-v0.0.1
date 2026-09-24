import { useEffect, useMemo, useRef } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { highlightBus } from './highlightBus'

interface MicroscopeProps {
  onClick?: () => void
}

// Punto de partida HEREDADO del laboratorio anterior (Sketchfab) — este
// modelo de microscopio y este lab.glb (Blender) son ambos nuevos, así que
// esta posición es una suposición razonable, no una calibración real para
// este par específico. Ajusta con la tecla P si no coincide con el
// mostrador de este cuarto.
const POSITION = new THREE.Vector3(0.39, 1.28, 1.7)
const TARGET_SIZE = 0.45 // tamaño razonable para un microscopio de sobremesa

/**
 * Modelo real: "Microscope" por VeeRuby Technologies Pvt Ltd (Sketchfab,
 * CC-BY-4.0) — dar crédito al autor si se publica. Espera
 * ./modelos/microscope/microscope.gltf + ./modelos/microscope/microscope.bin
 * (el .gltf ya trae su referencia interna corregida para apuntar a
 * "microscope.bin" en vez del "scene.bin" original de Sketchfab).
 */
export function Microscope({ onClick }: MicroscopeProps) {
  const { gl, camera } = useThree()
  const gltf = useLoader(GLTFLoader, './modelos/microscope/microscope.gltf')

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
      // Marca para que <SlideCase> reconozca "esto es el microscopio" y, al
      // soltar el portaobjetos encima, lo mande a la platina.
      child.userData.isScope = true
    })
    cloned.userData.isScope = true
    // Gira 90° a la derecha (sentido horario visto desde arriba) antes de
    // medir la caja, para que el reposicionamiento posterior siga dejando
    // el modelo centrado y apoyado en el mostrador.
    cloned.rotation.y -= (Math.PI / 2)*3

    // Normaliza tamaño (por dimensión más grande) y posiciona apoyado en
    // el punto de arriba — misma lógica de siempre, solo que a escala de
    // objeto de mesa en vez de escala de cuarto completo.
    const rawBox = new THREE.Box3().setFromObject(cloned)
    const rawSize = rawBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1
    cloned.scale.multiplyScalar(TARGET_SIZE / maxDim)

    const box = new THREE.Box3().setFromObject(cloned)
    const center = box.getCenter(new THREE.Vector3())
    cloned.position.x += POSITION.x - center.x
    cloned.position.z += POSITION.z - center.z
    cloned.position.y += POSITION.y - box.min.y

    return cloned
  }, [gltf])

  // Le dice al agente donde esta el microscopio, mismo patron que en
  // SlideCase.tsx.
  useEffect(() => {
    highlightBus.targets.microscopio = scene
    return () => { highlightBus.targets.microscopio = null }
  }, [scene])

  // Llamamos siempre a la última versión del handler vía este ref.
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  // Raycasting manual para el clic (igual que SlideCase / JarRow) — así un
  // arrastre para mirar no dispara la interacción.
  useEffect(() => {
    const canvas = gl.domElement
    const downPt = { x: 0, y: 0 }
    const ray = new THREE.Raycaster()

    const onDown = (e: MouseEvent) => { downPt.x = e.clientX; downPt.y = e.clientY }
    const onClickEvt = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 6) return
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      camera.updateMatrixWorld()
      ray.setFromCamera(ndc, camera)
      if (ray.intersectObject(scene, true).length > 0) onClickRef.current?.()
    }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('click', onClickEvt)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('click', onClickEvt)
    }
  }, [gl, camera, scene])

  return (
    <primitive
      object={scene}
      onPointerOver={() => { gl.domElement.style.cursor = 'pointer' }}
      onPointerOut={() => { gl.domElement.style.cursor = 'grab' }}
    />
  )
}
