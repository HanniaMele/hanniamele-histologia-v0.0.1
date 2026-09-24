/**
 * Estado del "modo prueba": el estudiante ya vio la preparación teñida con
 * Glía guiándolo y aceptó repetir el proceso solo, para que se le califique.
 *
 * Mismo patrón que slideBus/highlightBus — un singleton mutable, no estado
 * de React, porque <JarRow> necesita leerlo/escribirlo en cada clic sin
 * pasar por props desde <App>.
 */
export const examBus = {
  /** true mientras el estudiante está en el intento calificado (sin Glía). */
  active: false,
  /**
   * Orden REAL en que completó cada frasco (metió y sacó el portaobjetos),
   * en el orden en que lo hizo — sin importar si respetó la secuencia
   * correcta. Se usa al final para calificar qué tan fiel fue al proceso.
   * Se reinicia cada vez que arranca un intento nuevo.
   */
  log: [] as number[],
}
