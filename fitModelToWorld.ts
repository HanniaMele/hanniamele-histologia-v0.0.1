import * as THREE from 'three'

/**
 * Normaliza un modelo cargado a un tamaño de mundo conocido y lo apoya sobre
 * el piso en (x, z) — no sabemos la escala nativa con la que fue modelado,
 * así que medimos su bounding box real y reescalamos para que su dimensión
 * más grande mida `targetSize`. Misma lógica que usamos en la versión
 * vainilla y en el intento anterior de React.
 */
export function fitModelToWorld(
  model: THREE.Object3D,
  targetSize: number,
  floorX: number,
  floorZ: number,
  floorY = 0,
): THREE.Box3 {
  const rawBox = new THREE.Box3().setFromObject(model)
  const rawSize = rawBox.getSize(new THREE.Vector3())
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1
  model.scale.multiplyScalar(targetSize / maxDim)

  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  model.position.x += floorX - center.x
  model.position.z += floorZ - center.z
  model.position.y += floorY - box.min.y

  return new THREE.Box3().setFromObject(model)
}
