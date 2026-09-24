import { TOOL_SCHEMAS, TOOL_IMPLEMENTATIONS } from './agentTools'
import { highlightBus } from './highlightBus'
import { imageHighlightBus } from './imageHighlightBus'
import { slideBus } from './slideBus'
import { PREPARACION_ACTUAL } from './preparaciones'
import { SYSTEM_PROMPT } from './agentPrompt'

/**
 * "Contrato" de un mensaje de la conversación — el mismo shape que espera
 * Ollama en /api/chat. `tool_calls` solo aparece en mensajes del asistente
 * cuando decidió usar una tool en vez de (o antes de) responder en texto.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> | string }
  }>
}

// Nuestro propio backend (server/index.js) — NO Ollama directamente. Ver la
// explicación larga de por qué en server/index.js (resumen: CORS).
const BACKEND_URL = 'http://localhost:3001/api/chat'

// Por si el modelo entra en un loop llamando tools sin parar: después de
// esta cantidad de idas y vueltas, se corta y se regresa lo que haya, en
// vez de dejarte esperando para siempre.
const MAX_TOOL_ROUNDS = 4

// Red de seguridad para cuando el modelo NO llama a resaltar_objeto aunque
// debería (confirmado con gemma4:e2b: a veces contesta "dónde está X" en
// puro texto y nunca intenta la tool -- ni siquiera de forma rota, como
// atrapa extractTextToolCall más abajo, simplemente no la usa). Si el
// mensaje del estudiante suena a pedir ubicación y nombra un objeto
// conocido, señalamos y movemos la cámara ANTES de mandarle nada al modelo.
// Es inofensivo si el modelo también llama a la tool: es la misma acción,
// repetida.
const LOCATION_INTENT = /d[oó]nde (est[aá]|queda)|mu[eé]strame|se[ñn]ala(me)?|ens[eé][ñn]ame|ll[eé]va(me)?\b/i

const OBJECT_ALIASES: Array<[RegExp, string]> = [
  [/microscopio/i, 'microscopio'],
  [/microtomo/i, 'microtomo'],
  [/estuche/i, 'estuche'],
  [/100\s*%/, 'frasco-0'],
  [/95\s*%/, 'frasco-1'],
  [/90\s*%/, 'frasco-2'],
  [/85\s*%/, 'frasco-3'],
  [/80\s*%/, 'frasco-4'],
  [/70\s*%/, 'frasco-5'],
  [/h\s*&\s*e|hematoxilina|eosina/i, 'frasco-6'],
]

function detectLocationTarget(text: string): string | null {
  if (!LOCATION_INTENT.test(text)) return null
  for (const [re, key] of OBJECT_ALIASES) {
    if (re.test(text)) return key
  }
  return null
}

// Misma red de seguridad que LOCATION_INTENT, pero para "¿cómo empiezo?" /
// "¿qué hago primero?" -- acá el objeto correcto (el estuche) no está en el
// texto, así que no lo podemos sacar con OBJECT_ALIASES: lo sabemos porque
// es SIEMPRE el primer paso del proceso (tomar un portaobjetos). Confirmado
// con qwen3.5:0.8b: a veces sí sigue la instrucción del prompt y resalta el
// estuche, pero a veces resalta cualquier otra cosa (p. ej. el frasco de
// H&E) o directamente no llama a la tool -- este modelo es demasiado chico
// para seguir esa parte del prompt de forma confiable.
const START_INTENT = /c[oó]mo (empiezo|comienzo|arranco)|por d[oó]nde (empiezo|arranco|comienzo)|primer paso|qu[eé] hago (primero|para empezar)|c[oó]mo se hace esto/i

function detectStartTarget(text: string): string | null {
  // Solo aplica si de verdad es el arranque: sin portaobjetos en mano ni en
  // la platina. Con uno ya en mano, "¿cómo empiezo?" puede referirse a otra
  // cosa (p. ej. el primer frasco) y ahí sí confiamos en que el modelo lea
  // el Contexto del laboratorio del prompt.
  if (slideBus.held || slideBus.onScope) return null
  return START_INTENT.test(text) ? 'estuche' : null
}

// Misma idea que arriba, pero para "de qué estás hablando" DENTRO de la
// imagen del microscopio (senalar_en_imagen) — sin esto, Glía puede describir
// una estructura por forma/color/ubicación (a propósito, es el método
// socrático) y la estudiante no tiene ninguna pista visual de a qué parte de
// la imagen se refiere.
//
// Dos casos:
// 1. La pregunta nombra algo específico (una palabra de la descripción real
//    de la estructura, ej. "esa zona blanca") -> apunta a esa.
// 2. La pregunta es genérica ("¿qué es esto?", "explícame la imagen") y no
//    hay forma de saber cuál -- vamos rotando por las estructuras conocidas,
//    una por pregunta, así SIEMPRE hay algo señalado para mirar.
const IMAGE_STRUCTURE_ALIASES: Array<[RegExp, string]> = [
  [/cord[oó]n|hepatocit|poligonal/i, 'cordones_hepatocitos'],
  [/sinusoid|espacio.*clar|hueco/i, 'espacios_sinusoidales'],
  [/n[uú]cleo.*baso|kupffer|morad[oa]/i, 'nucleos_basofilos'],
]
const IMAGE_GENERIC_QUESTION = /qu[eé] (es|significa)|expl[ií]came|qu[eé] (veo|estoy viendo)/i

let structureCycleIndex = 0
function nextCycledStructure(): string | null {
  const list = PREPARACION_ACTUAL.estructurasVisibles
  if (list.length === 0) return null
  const clave = list[structureCycleIndex % list.length].clave
  structureCycleIndex++
  return clave
}

function detectImageStructureTarget(text: string): string | null {
  for (const [re, key] of IMAGE_STRUCTURE_ALIASES) {
    if (re.test(text)) return key
  }
  if (IMAGE_GENERIC_QUESTION.test(text)) return nextCycledStructure()
  return null
}

// Nombres de tools válidos, sacados de TOOL_SCHEMAS (no hardcodeados aparte)
// para que si agregas/quitas una tool en agentTools.ts esto no se desincronice.
const KNOWN_TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.function.name)

/**
 * Plan B para cuando el modelo NO manda un tool_calls de verdad, pero su
 * `content` de todos modos "parece" una llamada a una tool conocida — p. ej.
 * `resaltar_objeto{objeto:"estuche"}` escrito como si fuera texto normal, en
 * vez de usar el campo tool_calls que espera Ollama.
 *
 * Esto pasa con modelos que tienen soporte de tool calling flojo o
 * inconsistente (confirmado con gemma4:e2b: a veces sí manda tool_calls
 * real, a veces escribe la sintaxis como prosa). Sin este Plan B, ese texto
 * crudo se le mostraría a la usuaria en el chat en vez de ejecutarse.
 *
 * Es un heurístico, no un parser estricto — por diseño: mejor ejecutar de
 * más una tool inofensiva que dejar a la usuaria viendo código roto.
 */
function extractTextToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  if (!content) return null
  // Limpieza defensiva: algunos modelos (visto con gemma4:e2b) dejan tokens
  // especiales de su plantilla sin limpiar, tipo `<|"|>`, mezclados en el
  // texto. Los quitamos -- el parser de abajo no necesita comillas para
  // funcionar, así que basta con que no estorben.
  content = content.replace(/<\|[^|]*\|>/g, '')
  for (const name of KNOWN_TOOL_NAMES) {
    if (!content.includes(name)) continue
    const withBraces = content.match(new RegExp(`${name}[^{]*\\{([\\s\\S]*?)\\}`))
    if (!withBraces) {
      // El nombre aparece pero sin "{...}" detrás (p. ej. la tool sin
      // argumentos, escrita como "explicar_imagen_microscopio()" o solo el
      // nombre): asumimos que no lleva argumentos.
      return { name, arguments: {} }
    }
    const inner = withBraces[1]
    try {
      // Si ya viene como JSON válido (claves entre comillas), úsalo tal cual.
      return { name, arguments: JSON.parse(`{${inner}}`) }
    } catch {
      // Si no, es la forma suelta que vimos en la práctica: objeto:"estuche"
      // (claves sin comillas). La parseamos a mano, par por par.
      const args: Record<string, unknown> = {}
      for (const pair of inner.split(',')) {
        const m = pair.match(/^\s*"?([\w]+)"?\s*:\s*(.+?)\s*$/)
        if (!m) continue
        let val: unknown = m[2].trim()
        if (typeof val === 'string') {
          if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1)
          else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val)
        }
        args[m[1]] = val
      }
      return { name, arguments: args }
    }
  }
  return null
}

async function askBackend(messages: ChatMessage[]): Promise<ChatMessage> {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, tools: TOOL_SCHEMAS }),
  })
  if (!res.ok) {
    throw new Error(
      `El backend del agente respondió ${res.status}. ¿Está corriendo "npm run server"? ¿Está corriendo Ollama?`,
    )
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  // Ollama regresa { message: {...}, ... } en /api/chat con stream:false.
  return data.message as ChatMessage
}

/**
 * Pide una respuesta de UNA sola vuelta, SIN ofrecerle tools al modelo (a
 * diferencia de runAgentTurn, que siempre manda TOOL_SCHEMAS). Para tareas
 * que no son la conversación con Glía -- p. ej. calificar el examen (ver
 * examGrading.ts): confirmado en pruebas reales que si le mandás tools
 * disponibles, aunque el prompt no se lo pida, el modelo (hasta uno
 * chico como llama3.2:3b) puede quedarse llamando `explicar_imagen_microscopio`
 * en bucle en vez de contestar en el formato pedido -- agota las 4 rondas de
 * runAgentTurn sin nunca dar una respuesta usable. Sin tools en el request,
 * el modelo no tiene otra opción que responder en texto.
 */
export async function askPlain(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok) {
    throw new Error(`El backend del agente respondió ${res.status}.`)
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return (data.message?.content as string) ?? ''
}

/**
 * Precalienta el modelo mientras se muestra la presentación inicial
 * (ver IntroScreen.tsx). Ollama carga el modelo en memoria/VRAM la PRIMERA
 * vez que se lo usa -- confirmado en las pruebas: con qwen3.5:latest eso
 * solo (el load_duration) ya costó 8-23 segundos, aparte del tiempo real de
 * respuesta. Sin esto, esa carga pasaría en el primer mensaje real del
 * estudiante, justo cuando ya está mirando la escena.
 *
 * Manda el mismo SYSTEM_PROMPT que usará la conversación real (así, si el
 * modelo reutiliza el prefijo cacheado -- ver prompt_eval_cached_count en
 * las respuestas de Ollama --, ese precalentamiento también ahorra tiempo
 * ahí) más un mensaje de relleno cualquiera. La respuesta se descarta por
 * completo: esto NO aparece en el chat visible, es solo para forzar la
 * carga. Si Ollama todavía no está levantado, falla en silencio -- el
 * primer mensaje real del chat simplemente tardará lo de siempre.
 */
export function warmupAgent(): void {
  fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Preséntate en una frase.' },
      ],
      tools: TOOL_SCHEMAS,
    }),
  }).catch(() => {
    // Silencioso a propósito -- ver comentario de arriba.
  })
}

/**
 * Manda la conversación (`history`, que ya incluye el nuevo mensaje del
 * usuario) al agente y resuelve el ciclo completo de tool calls:
 *
 *   usuario -> [modelo decide usar una tool] -> ejecutamos la tool AQUÍ EN
 *   EL NAVEGADOR -> le regresamos el resultado al modelo -> el modelo
 *   sigue, ya sea pidiendo OTRA tool o respondiendo en texto normal.
 *
 * Regresa el historial completo actualizado (incluye los mensajes
 * intermedios de rol "tool"), para que la UI decida qué mostrar y qué no.
 */
export async function runAgentTurn(history: ChatMessage[]): Promise<ChatMessage[]> {
  const messages = [...history]

  // Red de seguridad (ver detectLocationTarget arriba): el último mensaje es
  // el que acaba de mandar el estudiante -- si pide ubicación, la calculamos
  // ya, pero OJO: no la aplicamos todavía. Aplicarla acá (antes de llamarle
  // siquiera al backend) hacía que la cámara arrancara a girar/caminar antes
  // de que Glía contestara una sola palabra -- se ve al revés. Se aplica
  // recién más abajo, junto con la respuesta final en texto.
  const lastMsg = messages[messages.length - 1]
  let pendingKey: string | null = null
  let pendingStructureKey: string | null = null
  if (lastMsg?.role === 'user') {
    pendingKey = detectLocationTarget(lastMsg.content) ?? detectStartTarget(lastMsg.content)
    // Solo tiene sentido señalar DENTRO de la imagen si hay una preparación
    // apoyada en el microscopio Y YA ESTÁ TEÑIDA (mismo requisito que usan
    // las tools reales) -- antes de eso no hay nada real que mostrar.
    if (slideBus.onScope && slideBus.stained) {
      pendingStructureKey = detectImageStructureTarget(lastMsg.content)
    }
  }
  const applyPending = () => {
    if (pendingKey) {
      highlightBus.active = pendingKey
      highlightBus.navTargetKey = pendingKey
    }
    if (pendingStructureKey) imageHighlightBus.set(pendingStructureKey)
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const assistantMsg = await askBackend(messages)

    let calls = assistantMsg.tool_calls
    if (!calls || calls.length === 0) {
      // El modelo no mandó tool_calls real -- ¿su texto de todos modos
      // "quería" llamar a una tool? (ver extractTextToolCall arriba).
      const fallback = extractTextToolCall(assistantMsg.content)
      if (fallback) {
        calls = [{ function: { name: fallback.name, arguments: fallback.arguments } }]
        // No le mostramos a la usuaria la sintaxis cruda de la llamada.
        assistantMsg.content = ''
      }
    }

    messages.push(assistantMsg)

    if (!calls || calls.length === 0) {
      applyPending() // respuesta final en texto: recién ahora se mueve la cámara
      return messages
    }

    for (const call of calls) {
      const impl = TOOL_IMPLEMENTATIONS[call.function.name]
      const rawArgs = call.function.arguments
      const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs ?? {}

      const result = impl
        ? impl(args)
        : { ok: false, error: `No existe la tool "${call.function.name}".` }

      messages.push({ role: 'tool', content: JSON.stringify(result) })
    }
    // Vuelve a preguntarle al backend, ya con los resultados de las tools
    // metidos en el historial, para que el modelo dé su respuesta final.
  }

  applyPending() // se acabaron las rondas sin respuesta final -- igual se mueve, al salir
  return messages
}
