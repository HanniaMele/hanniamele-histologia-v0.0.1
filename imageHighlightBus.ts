/**
 * Mismo espíritu que highlightBus.ts, pero para señalar una estructura
 * DENTRO de la imagen 2D del microscopio (#scopeView en App.tsx) — no en la
 * escena 3D.
 *
 * ¿Por qué no reusar highlightBus tal cual? Porque <Highlighter> vive dentro
 * del <Canvas> y lee el singleton en cada useFrame (60 veces por segundo, sin
 * pasar por el ciclo de renders de React). #scopeView es DOM normal, fuera
 * del Canvas — ahí no hay useFrame, así que si la tool cambia `active` nada
 * le avisa a React que tiene que volver a pintar. Por eso este bus SÍ lleva
 * una lista de "suscriptores": <ImageHighlight> (ver ImageHighlight.tsx) se
 * apunta con `subscribe` y usa useSyncExternalStore para re-renderizar justo
 * cuando la tool llama a `set`.
 */
type Listener = () => void
const listeners = new Set<Listener>()

export const imageHighlightBus = {
  /** Clave de la estructura resaltada ahora mismo (una de
   *  PREPARACION_ACTUAL.estructurasVisibles), o null si ninguna. */
  active: null as string | null,

  set(key: string | null) {
    imageHighlightBus.active = key
    listeners.forEach((fn) => fn())
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
