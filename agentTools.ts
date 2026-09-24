import { highlightBus } from './highlightBus'
import { imageHighlightBus } from './imageHighlightBus'
import { slideBus } from './slideBus'
import { PREPARACION_ACTUAL } from './preparaciones'

/**
 * Este archivo tiene DOS partes que hay que mantener sincronizadas a mano:
 *
 * 1. TOOL_SCHEMAS: la "ficha técnica" de cada tool, en el formato que
 *    Ollama espera (el mismo formato, con ligeras variantes, que usan
 *    OpenAI y Anthropic). Esto es lo que se le manda al modelo de lenguaje
 *    para que sepa qué herramientas existen y qué argumentos acepta cada
 *    una — el modelo NUNCA ejecuta código de verdad, solo devuelve algo
 *    como "quiero llamar a resaltar_objeto con objeto='frasco', indice=3",
 *    y es responsabilidad NUESTRA (ver TOOL_IMPLEMENTATIONS) ejecutarlo.
 *
 * 2. TOOL_IMPLEMENTATIONS: el código real que corre en TU navegador cuando
 *    el modelo pide usar una tool. Recibe los argumentos ya parseados y
 *    regresa algo (texto u objeto) que se le manda de vuelta al modelo
 *    como "resultado de la tool", para que pueda seguir la conversación
 *    sabiendo qué pasó.
 */

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'resaltar_objeto',
      description:
        'Señala un objeto de la escena 3D del laboratorio: le dibuja un contorno pulsante Y ADEMÁS hace que la cámara del estudiante gire para encararlo y camine hacia él hasta quedar cerca. Úsala cuando quieras dirigir la atención del estudiante a algo concreto: el estuche de portaobjetos, el microscopio, el microtomo, o un frasco específico de la fila de tinción. No la uses para objetos que no estén en la lista de abajo.',
      parameters: {
        type: 'object',
        properties: {
          objeto: {
            type: 'string',
            enum: ['estuche', 'microscopio', 'microtomo', 'frasco'],
            description: 'Qué tipo de objeto resaltar.',
          },
          indice: {
            type: 'integer',
            description:
              'Solo si objeto="frasco": el índice del frasco, de 0 (alcohol 100%) a 6 (H&E, la tinción final).',
          },
        },
        required: ['objeto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explicar_imagen_microscopio',
      description:
        'Obtiene los datos reales (tejido, tinción, estructuras visibles) de la preparación que se está viendo actualmente al microscopio. Úsala antes de explicar qué se ve en la imagen, en vez de inventar detalles histológicos.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'senalar_en_imagen',
      description:
        'Dibuja un recuadro pulsante sobre una estructura concreta DENTRO de la imagen del microscopio (no es la escena 3D — para eso usa resaltar_objeto). Pensada para guiar por método socrático: señala la estructura SIN decir todavía su nombre, y deja que el estudiante la identifique. Llama antes a explicar_imagen_microscopio si no sabes qué estructuras hay disponibles.',
      parameters: {
        type: 'object',
        properties: {
          estructura: {
            type: 'string',
            enum: PREPARACION_ACTUAL.estructurasVisibles.map((e) => e.clave),
            description: 'Clave de la estructura a señalar (viene de estructurasVisibles).',
          },
        },
        required: ['estructura'],
      },
    },
  },
]

function highlightKeyFor(objeto: string, indice?: number): string | null {
  if (objeto === 'estuche') return 'estuche'
  if (objeto === 'microscopio') return 'microscopio'
  if (objeto === 'microtomo') return 'microtomo'
  if (objeto === 'frasco') {
    if (typeof indice !== 'number' || indice < 0 || indice > 6) return null
    return `frasco-${indice}`
  }
  return null
}

export const TOOL_IMPLEMENTATIONS: Record<string, (args: any) => unknown> = {
  resaltar_objeto: ({ objeto, indice }: { objeto: string; indice?: number }) => {
    const key = highlightKeyFor(objeto, indice)
    if (!key) {
      return {
        ok: false,
        error: `No reconozco "${objeto}" (índice ${indice}) como algo que se pueda resaltar.`,
      }
    }
    // A proposito NO se apaga solo con un timer: con un modelo de 8B en
    // GPUs modestas, la respuesta final de texto puede tardar bastante mas
    // que un par de segundos (dos idas y vueltas a Ollama), y un timer fijo
    // se apagaba ANTES de que Hannia llegara a ver el mensaje que dice
    // "resaltado" -- justo el bug que reporto. Se queda resaltado hasta
    // que se pida resaltar otra cosa distinta.
    highlightBus.active = key
    // Además de resaltar, pide a <PlayerControls> que oriente la cámara hacia
    // este objeto y camine hasta acercarse. El movimiento se cancela solo si
    // el estudiante toma el control (mouse o WASD).
    highlightBus.navTargetKey = key
    return {
      ok: true,
      mensaje: `Resaltado: ${key}. La cámara está girando y acercándose a ${key}. Se queda resaltado hasta que se resalte otra cosa.`,
    }
  },

  explicar_imagen_microscopio: () => {
    if (!slideBus.onScope) {
      return {
        visible: false,
        mensaje:
          'Todavía no hay ningún portaobjetos apoyado en la platina del microscopio, así que no hay nada que ver por ahora.',
      }
    }
    if (!slideBus.stained) {
      return {
        visible: false,
        mensaje:
          'Hay un portaobjetos en la platina, pero todavía NO está teñido (no tiene el puntito morado) -- tiene que pasar por toda la fila de frascos, terminando en el de H&E, antes de que se pueda ver algo real al microscopio. Explícale esto al estudiante, no es un error tuyo ni una falla, es parte del proceso.',
      }
    }
    return { visible: true, preparacion: PREPARACION_ACTUAL }
  },

  senalar_en_imagen: ({ estructura }: { estructura: string }) => {
    if (!slideBus.onScope) {
      return {
        ok: false,
        error: 'No hay ninguna preparación apoyada en la platina del microscopio todavía.',
      }
    }
    if (!slideBus.stained) {
      return {
        ok: false,
        error: 'El portaobjetos todavía no está teñido -- no hay nada que señalar hasta que pase por el frasco de H&E.',
      }
    }
    const existe = PREPARACION_ACTUAL.estructurasVisibles.some((e) => e.clave === estructura)
    if (!existe) {
      return { ok: false, error: `No reconozco "${estructura}" como una estructura de esta preparación.` }
    }
    imageHighlightBus.set(estructura)
    return {
      ok: true,
      mensaje: `Recuadro puesto sobre "${estructura}" en la imagen. Si estás guiando por método socrático, no reveles su nombre todavía.`,
    }
  },
}
