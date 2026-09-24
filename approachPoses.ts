/**
 * Poses de acercamiento hechas a mano, por clave de objeto resaltable.
 *
 * El acercamiento automático ("encara y camina derecho al objeto") choca con
 * la mesa central cuando el objeto está SOBRE ella — por ejemplo los frascos
 * de la fila de tinción. Para esos casos definimos aquí una ruta y una pose
 * fijas: la cámara rodea la mesa por el carril despejado de la derecha
 * (respecto a la posición inicial) y se planta enfrente, girada 90° a la
 * izquierda, de modo que quede de frente a la fila.
 *
 * Si una clave NO está en este mapa, <PlayerControls> usa el acercamiento
 * automático de siempre.
 *
 * Para calibrar coordenadas: en la app, párate donde quieras y pulsa la
 * tecla P — sale la posición x/z de la cámara en pantalla.
 */
export interface ApproachPose {
  /** Puntos intermedios (world x, z) por los que pasa antes de `pos`. */
  via?: Array<[number, number]>
  /** Dónde se planta la cámara (world x, z). La altura la fija PlayerControls. */
  pos: [number, number]
  /**
   * Yaw final en radianes: 0 = mirando a -Z (la pose inicial), +Math.PI/2 =
   * 90° a la izquierda (mirando a -X). Si se omite, la cámara encara el
   * centro del objeto desde `pos`.
   */
  yaw?: number
}

// Carril a la derecha de la mesa central (respecto a la posición inicial),
// despejado de muebles. Se usa para rodearla al ir hacia la fila de frascos.
// Ajústalos con la tecla P si la cámara roza la mesa o queda muy lejos.
const RIGHT_LANE_X = 1.3
const RIGHT_LANE_ENTRY_Z = 2.2

// Entra al carril derecho y se para justo enfrente del punto (RIGHT_LANE_X,
// z), girada 90° a la izquierda. Todo lo que vive sobre el mostrador (los
// frascos, el microscopio, el estuche) comparte esta misma forma de
// acercarse -- solo cambia la z a la que se detiene.
function counterPose(z: number): ApproachPose {
  return {
    via: [[RIGHT_LANE_X, RIGHT_LANE_ENTRY_Z]],
    pos: [RIGHT_LANE_X, z],
    yaw: Math.PI / 2,
  }
}

// La fila de frascos (ver JarRow.tsx) está centrada en world (0.52, _, 0.9) y
// girada 90°, así que corre a lo largo de Z: el frasco i cae en
//   world z = 0.9 - (i - 3) * 0.14
// El frasco 6 es la solución de H&E; el 0, el alcohol 100%.
function jarPose(i: number): ApproachPose {
  return counterPose(0.9 - (i - 3) * 0.14)
}

// Microscopio (Microscope.tsx: POSITION z=1.7) y estuche de portaobjetos
// (SlideCase.tsx: CASE_POS z=1.70) están prácticamente uno al lado del otro
// en el mostrador, así que se paran en el mismo punto del carril.
export const APPROACH_POSES: Record<string, ApproachPose> = {
  'frasco-0': jarPose(0),
  'frasco-1': jarPose(1),
  'frasco-2': jarPose(2),
  'frasco-3': jarPose(3),
  'frasco-4': jarPose(4),
  'frasco-5': jarPose(5),
  'frasco-6': jarPose(6),
  microscopio: counterPose(1.7),
  estuche: counterPose(1.7),
}
