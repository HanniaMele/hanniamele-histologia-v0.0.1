import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { highlightBus } from './highlightBus'

/**
 * El "reflector" del agente: dibuja un contorno pulsante alrededor de lo que
 * highlightBus.active esté señalando en este momento.
 *
 * ¿Por qué una caja de líneas y no, por ejemplo, cambiar el color del
 * material del objeto señalado? Porque no sabemos de antemano qué material
 * tiene cada cosa — el estuche, el microscopio y los frascos vienen de
 * modelos .gltf distintos, cada uno con sus propios materiales y texturas.
 * Envolver con una caja funciona igual sin importar qué hay adentro.
 *
 * ¿Por qué LineSegments2 (three/examples/jsm/lines/) y no el Box3Helper de
 * toda la vida? Box3Helper dibuja líneas "normales" de WebGL, y su grosor
 * (linewidth) casi nunca se respeta en el navegador -- queda en 1px sin
 * importar qué valor le pongas, es una limitación conocida de WebGL/three.js.
 * LineSegments2 (el paquete de "fat lines" de three.js) sí dibuja líneas con
 * grosor real en píxeles de pantalla, vía shader -- por eso hace falta un
 * poco más de armado (geometría de los 12 bordes de una caja unitaria,
 * reescalada cada frame; material con la resolución del canvas).
 */

// Los 12 bordes de una caja unitaria (-0.5 a 0.5 en cada eje), como pares de
// puntos -- se calcula una sola vez a nivel de módulo. Luego, cada frame,
// solo se reposiciona/reescala el objeto entero para que calce con la caja
// real del target, en vez de reconstruir geometría.
const UNIT_BOX_EDGES = (() => {
  const c: Array<[number, number, number]> = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ]
  const edges: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0], // cara de abajo
    [4, 5], [5, 6], [6, 7], [7, 4], // cara de arriba
    [0, 4], [1, 5], [2, 6], [3, 7], // verticales
  ]
  const positions: number[] = []
  for (const [a, b] of edges) positions.push(...c[a], ...c[b])
  return positions
})()

// Un poco más grande que la caja real del objeto, para que el contorno no
// quede pegado a su superficie.
const PADDING = 1.06

export function Highlighter() {
  const { size } = useThree()
  const box = useRef(new THREE.Box3())
  const center = useRef(new THREE.Vector3())
  const boxSize = useRef(new THREE.Vector3())

  const geometry = useMemo(() => {
    const g = new LineSegmentsGeometry()
    g.setPositions(UNIT_BOX_EDGES)
    return g
  }, [])

  const material = useMemo(
    () =>
      new LineMaterial({
        color: 0xffcc33,
        linewidth: 3, // px de pantalla (LineMaterial con worldUnits=false, el default)
        transparent: true,
      }),
    [],
  )

  // LineMaterial necesita saber el tamaño del canvas en píxeles para poder
  // convertir "linewidth" a grosor real en pantalla -- sin esto, las líneas
  // no se ven o salen con el grosor equivocado. Se actualiza solo si el
  // canvas cambia de tamaño (p. ej. la ventana se redimensiona).
  useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [material, size])

  const line = useMemo(() => {
    const l = new LineSegments2(geometry, material)
    l.visible = false
    return l
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, material])

  useFrame(({ clock }) => {
    const key = highlightBus.active
    const target = key ? highlightBus.targets[key] : null

    if (!target) {
      line.visible = false
      return
    }

    line.visible = true
    box.current.setFromObject(target)
    box.current.getCenter(center.current)
    box.current.getSize(boxSize.current)
    line.position.copy(center.current)
    line.scale.set(boxSize.current.x * PADDING, boxSize.current.y * PADDING, boxSize.current.z * PADDING)

    // Pulso simple: la opacidad sube y baja entre ~0.3 y 1 con el tiempo,
    // para que el contorno "respire" en vez de quedarse fijo.
    material.opacity = 0.65 + Math.sin(clock.elapsedTime * 4) * 0.35
  })

  return <primitive object={line} />
}
