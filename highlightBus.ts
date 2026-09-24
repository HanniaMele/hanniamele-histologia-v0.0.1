import * as THREE from 'three'

/**
 * Mismo patrón que slideBus.ts: un singleton mutable que varios componentes
 * comparten sin pasar por props ni por el árbol de React.
 *
 * ¿Para qué sirve? Cuando el agente quiere "señalar" algo — el estuche, el
 * microscopio, un frasco — necesita una forma de decirle a la escena 3D
 * "pon el foco aquí", sin que la lógica del agente tenga que saber nada de
 * Three.js. Este bus es ese puente:
 *
 *   1. Cada componente (SlideCase, Microscope, JarRow) se REGISTRA aquí al
 *      montar, guardando una referencia a su propio Object3D bajo una clave
 *      de texto ("estuche", "microscopio", "frasco-3", ...).
 *   2. La tool `resaltar_objeto` (en agentTools.ts) solo escribe
 *      `highlightBus.active = "estuche"` — no toca Three.js para nada.
 *   3. El componente <Highlighter> (en Highlighter.tsx) lee `active` en
 *      cada frame, busca el Object3D correspondiente en `targets`, y
 *      dibuja un contorno pulsante alrededor. No necesita saber qué ES
 *      cada objeto, solo su caja (bounding box).
 */
export const highlightBus = {
  /** Object3D real de cada cosa que se puede resaltar, por clave. */
  targets: {} as Record<string, THREE.Object3D | null>,
  /** Clave actualmente resaltada (una de las de `targets`), o null. */
  active: null as string | null,
  /**
   * Clave hacia la que la cámara debe orientarse y acercarse ahora mismo, o
   * null si no hay ninguna. La tool `resaltar_objeto` la escribe junto con
   * `active`; <PlayerControls> la lee en cada frame, gira la cámara para
   * encarar ese objeto y camina hacia él hasta dejar una distancia corta, y
   * después la vuelve a poner en null. Cualquier control manual (arrastrar
   * el mouse o WASD) también la limpia, para no pelearse con la usuaria.
   */
  navTargetKey: null as string | null,
}
