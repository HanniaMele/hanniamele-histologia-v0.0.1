import { highlightBus } from './highlightBus'

/**
 * Canal para que partes de la escena (por ahora: JarRow, validando el orden
 * de la fila de frascos) le "hablen" a Glía SIN pasar por el modelo de
 * lenguaje. Son mensajes deterministas — "te faltó el portaobjetos", "ese
 * frasco no toca todavía" — que ya sabemos con certeza en el momento en que
 * pasan; mandarlos a Ollama sería más lento y, peor, dependería de que el
 * modelo decida llamar a la tool correcta (que ya nos ha fallado). En vez de
 * eso, <AgentChat> se suscribe aquí y mete el mensaje directo al historial,
 * en la voz de Glía, sin ninguna llamada al backend.
 *
 * Además de avisar, `send` señala y lleva la cámara al objeto relevante
 * PARA CORREGIR el error (vía highlightBus) — no al último objeto que el
 * estudiante le haya preguntado por el chat. Si te faltó portaobjetos,
 * apunta al estuche; si te saltaste el orden, apunta al frasco que sigue.
 */
type Listener = (message: string) => void
const listeners = new Set<Listener>()

export const agentNotices = {
  send(message: string, pointAt?: string) {
    if (pointAt) {
      highlightBus.active = pointAt
      highlightBus.navTargetKey = pointAt
    }
    listeners.forEach((fn) => fn(message))
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
