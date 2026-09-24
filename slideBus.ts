import * as THREE from 'three'

/**
 * Puente mínimo entre <SlideCase> y <JarRow>.
 *
 * <SlideCase> es quien "toma" un portaobjetos y lo mantiene flotando frente
 * a la cámara. <JarRow> necesita, en cierto momento, tomar prestado ESE
 * mismo portaobjetos para sumergirlo en una solución. En vez de subir todo
 * ese estado a <App> y reescribir ambos componentes, comparten este
 * singleton mutable — sin estado de React, ambos lo leen y escriben desde
 * sus `useFrame`.
 */
export const slideBus = {
  /** El THREE.Group del portaobjetos en mano, o null si no hay ninguno. */
  group: null as THREE.Group | null,
  /** true mientras <SlideCase> lo tiene tomado (aún no lo soltó en una superficie). */
  held: false,
  /** Índice del frasco que se lo apropió para sumergirlo, o null si nadie. */
  claimedByJar: null as number | null,
  /** true una vez que el portaobjetos pasó por la solución de H&E: sale con
   *  un puntito morado (la muestra teñida) en el centro. */
  stained: false,
  /** true cuando hay un portaobjetos apoyado en la platina del microscopio:
   *  habilita abrir la imagen al hacer clic en el microscopio. */
  onScope: false,
}
