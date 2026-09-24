import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { fitModelToWorld } from './fitModelToWorld'

interface LabRoomProps {
  collidables: React.RefObject<THREE.Object3D[]>
}

/**
 * Modelo real del laboratorio (.glb, exportado desde Blender). Vive en
 * ./modelos/lab_room/lab.glb — carpetas sí soportadas para assets, a
 * diferencia de los archivos de código fuente que hay que crear sueltos.
 *
 * Clonamos antes de transformar: `useLoader` cachea y reutiliza el mismo
 * `gltf.scene` entre renders, y StrictMode (en main.tsx) vuelve a invocar
 * este useMemo dos veces en desarrollo — si mutáramos el original
 * directamente, la segunda pasada re-escalaría un objeto que ya había
 * sido escalado.
 */
export function LabRoom({ collidables }: LabRoomProps) {
  const gltf = useLoader(GLTFLoader, './modelos/lab_room/lab.glb')

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = true
      }
    })
    fitModelToWorld(cloned, 10, 0, 0, 0)
    return cloned
  }, [gltf])

  // Registra las mallas de este modelo como colisionables — con cleanup
  // simétrico para que el doble-montaje de StrictMode no duplique entradas.
  useEffect(() => {
    const meshes: THREE.Object3D[] = []
    scene.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child) })
    collidables.current.push(...meshes)
    return () => {
      collidables.current = collidables.current.filter((m) => !meshes.includes(m))
    }
  }, [scene, collidables])

  return <primitive object={scene} />
}
