import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { highlightBus } from './highlightBus'
import { APPROACH_POSES } from './approachPoses'

const EYE_H = 1.62
const MOVE_SPEED = 3.0
const PLAYER_RADIUS = 0.35 // qué tan cerca de una pared/mueble puede llegar antes de bloquearse

// Alturas (en metros desde el piso) a las que se prueba el choque al caminar.
// Con un solo rayo a la altura de los ojos, el jugador atravesaba el
// mostrador y las mesas (~1.3 m de alto): el rayo les pasaba por encima.
// Ahora se lanza un abanico y se toma el choque más cercano de todos —
// incluye espinilla y cintura para frenar contra los muebles bajos.
const COLLIDE_HEIGHTS = [0.35, 0.95, 1.45, EYE_H]

// ── Navegación asistida por el agente (highlightBus.navTargetKey) ──
const NAV_TURN_RATE = 5.0   // rad/s: qué tan rápido gira la cámara para encarar el objeto
const NAV_MOVE_SPEED = 1.8  // m/s al acercarse (a propósito más lento que caminar a mano)
const NAV_STANDOFF = 0.7    // metros que deja entre la cámara y la superficie aprox. del objeto
const NAV_DONE_ANGLE = 0.04 // rad: por debajo de este error angular se considera "ya lo encaró"
const NAV_TIMEOUT = 6.0     // s: si no llegó en este tiempo (mueble en medio, etc.), suelta el control
const NAV_PITCH_LIMIT = 1.15 // mismo tope que el control manual del mouse
const NAV_WAYPOINT_EPS = 0.15 // m: se considera que "llegó" a un punto de la ruta

// Temporales de módulo para no crear objetos por frame.
const _navBox = new THREE.Box3()
const _navCenter = new THREE.Vector3()
const _navSize = new THREE.Vector3()
const _rayOrigin = new THREE.Vector3()

interface PlayerControlsProps {
  bounds?: number
  spawn?: [number, number, number]
  collidables: React.RefObject<THREE.Object3D[]>
}

/**
 * Mismo esquema que la versión vainilla: clic y arrastra para mirar, WASD
 * para caminar. Nuevo esta vez: colisiones reales contra las mallas del
 * modelo cargado (no existían en la versión vainilla). Se prueba el
 * movimiento en X y en Z por separado — así, si chocas de frente contra
 * una pared en diagonal, sigues pudiendo deslizarte a lo largo de ella en
 * vez de quedarte pegada en seco.
 */
export function PlayerControls({ bounds = 4.5, spawn = [0, EYE_H, 3], collidables }: PlayerControlsProps) {
  const { camera, gl } = useThree()
  const yaw = useRef(0)
  const pitch = useRef(0)
  const keys = useRef<Record<string, boolean>>({})
  const dragging = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const walkTime = useRef(0)
  const raycaster = useRef(new THREE.Raycaster())
  // Navegación asistida: cuánto lleva persiguiendo el target actual y cuál
  // era, para reiniciar el cronómetro cuando el agente cambia de objetivo.
  const navElapsed = useRef(0)
  const navPrevKey = useRef<string | null>(null)
  // Ruta pendiente hacia la pose (puntos world x,z) y yaw final autorizado.
  const navQueue = useRef<Array<[number, number]>>([])
  const navFacing = useRef<number | null>(null)
  const navHasPose = useRef(false)

  useEffect(() => {
    camera.position.set(spawn[0], spawn[1], spawn[2])
    camera.rotation.order = 'YXZ'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])

  useEffect(() => {
    const canvas = gl.domElement
    canvas.style.cursor = 'grab'

    const onMouseDown = (e: MouseEvent) => {
      dragging.current = true
      last.current = { x: e.clientX, y: e.clientY }
      canvas.style.cursor = 'grabbing'
      // La usuaria tomó el control de la vista: cancela cualquier
      // acercamiento que el agente haya pedido.
      highlightBus.navTargetKey = null
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - last.current.x
      const dy = e.clientY - last.current.y
      yaw.current -= dx * 0.0032
      pitch.current = Math.max(-1.15, Math.min(1.15, pitch.current - dy * 0.0032))
      last.current = { x: e.clientX, y: e.clientY }
    }
    const onMouseUp = () => {
      dragging.current = false
      canvas.style.cursor = 'grab'
    }
    // Si estas escribiendo en un input (p. ej. el chat del agente), las
    // teclas son texto, no controles de movimiento — ignoralas para que
    // WASD no mueva la camara mientras escribes. El keyup SI se procesa
    // siempre (aunque el foco ya haya cambiado), para no dejar una tecla
    // "atorada" como presionada si la sueltas ya con el input enfocado.
    const isTypingTarget = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA'
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return
      const k = e.key.toLowerCase()
      keys.current[k] = true
      // Si empieza a caminar a mano, cancela el acercamiento del agente.
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        highlightBus.navTargetKey = null
      }
    }
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [gl])

  /** Prueba mover `amount` unidades en una sola dirección de eje (X o Z);
   * si hay una malla colisionable en el camino, avanza solo hasta quedar
   * a PLAYER_RADIUS de distancia de ella, en vez de atravesarla. */
  function moveAxis(from: THREE.Vector3, axisMove: THREE.Vector3): THREE.Vector3 {
    const dist = axisMove.length()
    if (dist < 1e-6) return from
    const dir = axisMove.clone().normalize()
    const objs = collidables.current
    if (objs.length > 0) {
      const maxReach = dist + PLAYER_RADIUS
      // Abanico de rayos a varias alturas desde el mismo (x, z): así un
      // mueble bajo (mostrador, mesa) frena aunque el rayo a la altura de
      // los ojos le pase por encima. Nos quedamos con el choque más cercano.
      let nearest = Infinity
      for (const h of COLLIDE_HEIGHTS) {
        _rayOrigin.set(from.x, h, from.z)
        raycaster.current.set(_rayOrigin, dir)
        raycaster.current.far = maxReach
        const hits = raycaster.current.intersectObjects(objs, false)
        if (hits.length > 0 && hits[0].distance < nearest) nearest = hits[0].distance
      }
      if (nearest < maxReach) {
        const allowed = Math.max(0, nearest - PLAYER_RADIUS)
        return from.clone().add(dir.multiplyScalar(allowed))
      }
    }
    return from.clone().add(axisMove)
  }

  useFrame((_, delta) => {
    camera.rotation.set(pitch.current, yaw.current, 0)

    // ── Navegación asistida: el agente pidió acercarse a un objeto ──
    const navKey = highlightBus.navTargetKey
    if (!navKey) {
      navPrevKey.current = null
    } else {
      // Objetivo nuevo: arma la ruta (puntos intermedios + pose) desde el
      // mapa hecho a mano. Sin entrada en el mapa, `navHasPose` queda en
      // false y se usa el acercamiento automático (encara y avanza directo).
      if (navKey !== navPrevKey.current) {
        navPrevKey.current = navKey
        navElapsed.current = 0
        const pose = APPROACH_POSES[navKey]
        navHasPose.current = !!pose
        navFacing.current = pose?.yaw ?? null

        if (!pose) {
          navQueue.current = []
        } else {
          // Ojo: el via SIEMPRE apunta al punto de entrada del carril, pero
          // si ya estás parada cerca de `pos` (p. ej. pediste el microscopio
          // y ahora pedís el estuche, que comparte la misma pose), pasar por
          // ahí te manda a caminar de regreso y otra vez para adelante —
          // se ve como si "diera la vuelta" sin necesidad. Nos quedamos solo
          // con los puntos que de verdad acercan más al destino de lo que ya
          // estás: si ya estás igual de cerca (o más) que lo que un punto
          // dejaría, nos lo saltamos.
          const dest = pose.pos
          const curDistToDest = Math.hypot(dest[0] - camera.position.x, dest[1] - camera.position.z)
          navQueue.current = [...(pose.via ?? []), dest].filter((wp) => {
            const distFromWpToDest = Math.hypot(dest[0] - wp[0], dest[1] - wp[1])
            return distFromWpToDest < curDistToDest - NAV_WAYPOINT_EPS
          })
        }
      }

      const targetObj = highlightBus.targets[navKey]
      if (!targetObj) {
        highlightBus.navTargetKey = null
      } else if (navElapsed.current > NAV_TIMEOUT) {
        // Se acabó el tiempo (un mueble en medio, ruta mal calibrada, etc.):
        // suelta el control en vez de dejar a la cámara empujando una pared.
        highlightBus.navTargetKey = null
      } else {
        navElapsed.current += delta

        if (navQueue.current.length > 0) {
          // ─ Fase 1: caminar por la ruta hasta la pose ─
          const [wx, wz] = navQueue.current[0]
          const dx = wx - camera.position.x
          const dz = wz - camera.position.z
          const d = Math.hypot(dx, dz) || 1e-6
          if (d < NAV_WAYPOINT_EPS) {
            navQueue.current.shift()
          } else {
            const step = Math.min(NAV_MOVE_SPEED * delta, d)
            let pos = camera.position.clone()
            pos = moveAxis(pos, new THREE.Vector3((dx / d) * step, 0, 0))
            pos = moveAxis(pos, new THREE.Vector3(0, 0, (dz / d) * step))
            camera.position.x = Math.max(-bounds, Math.min(bounds, pos.x))
            camera.position.z = Math.max(-bounds, Math.min(bounds, pos.z))
            // Mientras camina, ya gira hacia el encuadre FINAL (si la pose
            // trae uno fijo) en vez de hacia la dirección en la que avanza.
            // Así, si el destino comparte el mismo ángulo de vista que el
            // punto de partida (p. ej. deslizarse de un frasco a otro por el
            // mismo carril: misma pose, mismo yaw=90°), la cámara solo se
            // traslada -- no gira "de más" para tener que corregirse al
            // llegar. Sin pose (fallback), sigue mirando hacia donde camina,
            // como antes.
            const faceYaw = navFacing.current ?? Math.atan2(-dx, -dz)
            const dY = Math.atan2(Math.sin(faceYaw - yaw.current), Math.cos(faceYaw - yaw.current))
            yaw.current += Math.sign(dY) * Math.min(Math.abs(dY), NAV_TURN_RATE * delta)
            pitch.current += (0 - pitch.current) * Math.min(1, 8 * delta)
            camera.rotation.set(pitch.current, yaw.current, 0)
          }
        } else {
          // ─ Fase 2: ya en la pose (o sin ruta) → encarar el objetivo ─
          _navBox.setFromObject(targetObj)
          _navBox.getCenter(_navCenter)
          _navBox.getSize(_navSize)
          const objRadius = Math.max(_navSize.x, _navSize.y, _navSize.z) * 0.5

          const dx = _navCenter.x - camera.position.x
          const dz = _navCenter.z - camera.position.z
          const dy = _navCenter.y - camera.position.y
          const horiz = Math.hypot(dx, dz) || 1e-6

          // Yaw objetivo: el autorizado por la pose, o encarar el objeto.
          const goalYaw = navFacing.current ?? Math.atan2(-dx, -dz)
          const goalPitch = Math.max(-NAV_PITCH_LIMIT, Math.min(NAV_PITCH_LIMIT, Math.atan2(dy, horiz)))
          const dYaw = Math.atan2(Math.sin(goalYaw - yaw.current), Math.cos(goalYaw - yaw.current))
          yaw.current += Math.sign(dYaw) * Math.min(Math.abs(dYaw), NAV_TURN_RATE * delta)
          pitch.current += (goalPitch - pitch.current) * Math.min(1, 8 * delta)

          // Con pose a mano, la posición ya es la buena: solo gira. Sin pose,
          // además avanza hasta dejar NAV_STANDOFF de la superficie del objeto.
          let closeEnough = true
          if (!navHasPose.current) {
            const stopDist = objRadius + NAV_STANDOFF
            if (horiz > stopDist) {
              closeEnough = false
              const stepLen = Math.min(NAV_MOVE_SPEED * delta, horiz - stopDist)
              let pos = camera.position.clone()
              pos = moveAxis(pos, new THREE.Vector3((dx / horiz) * stepLen, 0, 0))
              pos = moveAxis(pos, new THREE.Vector3(0, 0, (dz / horiz) * stepLen))
              camera.position.x = Math.max(-bounds, Math.min(bounds, pos.x))
              camera.position.z = Math.max(-bounds, Math.min(bounds, pos.z))
            }
          }

          camera.rotation.set(pitch.current, yaw.current, 0)

          if (Math.abs(dYaw) < NAV_DONE_ANGLE && closeEnough) {
            highlightBus.navTargetKey = null
          }
        }
      }
    }

    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    dir.y = 0
    dir.normalize()
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize()
    const move = new THREE.Vector3()
    if (keys.current['w'] || keys.current['arrowup']) move.add(dir)
    if (keys.current['s'] || keys.current['arrowdown']) move.sub(dir)
    if (keys.current['d'] || keys.current['arrowright']) move.add(right)
    if (keys.current['a'] || keys.current['arrowleft']) move.sub(right)

    let walking = false
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * delta)

      let pos = camera.position.clone()
      pos = moveAxis(pos, new THREE.Vector3(move.x, 0, 0))
      pos = moveAxis(pos, new THREE.Vector3(0, 0, move.z))

      camera.position.x = Math.max(-bounds, Math.min(bounds, pos.x))
      camera.position.z = Math.max(-bounds, Math.min(bounds, pos.z))
      walking = true
      walkTime.current += delta
    }
    camera.position.y = EYE_H + (walking ? Math.sin(walkTime.current * 9) * 0.012 : 0)
  })

  return null
}
