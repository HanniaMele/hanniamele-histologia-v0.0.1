import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { highlightBus } from './highlightBus'

/**
 * Modelo real del microtomo rotatorio (.glb). Vive en
 * ./modelos/microtome/rotatory_microtome.glb — misma carpeta de assets que
 * el resto de ./modelos/.
 *
 * Se apoya sobre la mesa de ese rincón del laboratorio (bounding box real
 * medida en lab.glb: centro ≈ (-2.25, 0.67, 4.39), tope ≈ y=1.22) — misma
 * altura de mostrador que usa Microscope.tsx para su propia mesa. Misma
 * lógica de normalización: escala por la dimensión mayor y apoya en el
 * punto de arriba (box.min.y -> POSITION.y).
 */
const POSITION = new THREE.Vector3(-2.4, 1.22, 4.5)
// Girado 180° respecto a como viene el .glb (quedaba mirando para el lado
// contrario al resto del mostrador).
const ROTATION_Y = Math.PI
const TARGET_SIZE = 0.5 // tamaño razonable para un microtomo de sobremesa

export function Microtome() {
  const gltf = useLoader(GLTFLoader, './modelos/microtome/rotatory_microtome.glb')

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    const rawBox = new THREE.Box3().setFromObject(cloned)
    const rawSize = rawBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1
    cloned.scale.multiplyScalar(TARGET_SIZE / maxDim)
    cloned.rotation.y = ROTATION_Y

    const box = new THREE.Box3().setFromObject(cloned)
    const center = box.getCenter(new THREE.Vector3())
    cloned.position.x += POSITION.x - center.x
    cloned.position.z += POSITION.z - center.z
    cloned.position.y += POSITION.y - box.min.y

    return cloned
  }, [gltf])

  // Le dice al agente donde esta el microtomo, mismo patron que en
  // Microscope.tsx / SlideCase.tsx.
  useEffect(() => {
    highlightBus.targets.microtomo = scene
    return () => { highlightBus.targets.microtomo = null }
  }, [scene])

  return <primitive object={scene} />
}
