import { askPlain } from './ollamaClient'
import { PREPARACION_ACTUAL } from './preparaciones'

// Mismo orden que JAR_LABELS en JarRow.tsx: 100% → 95% → 90% → 85% → 80% →
// 70% → H&E.
const CORRECT_ORDER = [0, 1, 2, 3, 4, 5, 6]
const JAR_LABELS = [
  'Alcohol 100%',
  'Alcohol 95%',
  'Alcohol 90%',
  'Alcohol 85%',
  'Alcohol 80%',
  'Alcohol 70%',
  'H&E',
]

export interface ExamResult {
  /** 0-10, redondeado — mitad por fidelidad al proceso, mitad por las 2 respuestas. */
  score: number
  feedback: string
}

/**
 * Subsecuencia común más larga entre el orden real y el correcto — mide
 * cuántos pasos quedaron en la posición relativa correcta SIN que un salto
 * en el medio arruine los que sí estuvieron bien antes y después (un simple
 * "cuántos coinciden índice a índice" penalizaría de más un solo frasco
 * salteado, corriendo todo lo que viene después).
 */
function lcsLength(a: number[], b: number[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

/**
 * Descripción determinista (no depende del modelo) del orden real vs. el
 * correcto — así la parte de "fidelidad al proceso" del resultado siempre
 * es exacta, sin depender de que un modelo chico sepa contar bien.
 */
function describeProcess(log: number[]): string {
  if (log.length === 0) return 'No llegó a completar ningún frasco.'
  const done = log.map((i) => JAR_LABELS[i] ?? `frasco ${i}`).join(' → ')
  const missing = CORRECT_ORDER.filter((i) => !log.includes(i)).map((i) => JAR_LABELS[i])
  let desc = `Orden real: ${done}.`
  if (missing.length > 0) desc += ` Se saltó: ${missing.join(', ')}.`
  return desc
}

const GRADING_SYSTEM_PROMPT = `Eres Glía, calificando el intento de un estudiante en la prueba de tinción del laboratorio de histología virtual. Tu ÚNICA tarea acá es juzgar si sus 2 respuestas sobre lo que ve en la imagen coinciden con alguna de las estructuras reales de abajo -- el proceso de tinción NO lo evalúas vos, eso ya se calculó aparte con datos exactos.

Contestá en EXACTAMENTE 2 líneas, con este formato y nada más (sin saludo, sin explicación fuera de esas 2 líneas):
RESPUESTA_1: correcta - <por qué, en pocas palabras>
RESPUESTA_2: correcta - <por qué, en pocas palabras>
(o "incorrecta" en vez de "correcta" si no coincide con ninguna estructura real)

Una respuesta es "correcta" si nombra o describe razonablemente bien CUALQUIERA de las estructuras reales -- no hace falta el nombre técnico exacto, alcanza con que se note que reconoció la misma estructura. Una respuesta vacía o que diga "no sé" es incorrecta.`

function buildAnswersUserMessage(answer1: string, answer2: string): string {
  const estructuras = PREPARACION_ACTUAL.estructurasVisibles.map((e) => `- ${e.descripcion}`).join('\n')
  return `Estructuras reales visibles en esta preparación:\n${estructuras}\n\nRespuesta 1 del estudiante: "${answer1 || '(vacía)'}"\nRespuesta 2 del estudiante: "${answer2 || '(vacía)'}"`
}

function parseAnswerVerdicts(text: string) {
  const m1 = /RESPUESTA_1:\s*(correcta|incorrecta)\s*-?\s*(.*)/i.exec(text)
  const m2 = /RESPUESTA_2:\s*(correcta|incorrecta)\s*-?\s*(.*)/i.exec(text)
  return {
    correct1: m1?.[1].toLowerCase() === 'correcta',
    reason1: m1?.[2]?.trim() ?? '',
    correct2: m2?.[1].toLowerCase() === 'correcta',
    reason2: m2?.[2]?.trim() ?? '',
    parsed: !!m1 && !!m2,
  }
}

/**
 * Califica un intento completo: fidelidad al proceso (determinista, a partir
 * de examBus.log) + corrección de las 2 respuestas sobre la imagen (esto sí
 * requiere juicio semántico, así que se lo pedimos al modelo).
 */
export async function gradeExam(log: number[], answer1: string, answer2: string): Promise<ExamResult> {
  const processDesc = describeProcess(log)
  const processScore = (lcsLength(log, CORRECT_ORDER) / CORRECT_ORDER.length) * 5

  let verdict = { correct1: false, reason1: '', correct2: false, reason2: '', parsed: false }
  let modelFailed = false
  try {
    // askPlain, no runAgentTurn -- esta llamada NO debe tener tools
    // disponibles (ver el comentario en ollamaClient.ts: con tools
    // ofrecidas, el modelo puede quedarse llamando explicar_imagen_microscopio
    // en bucle en vez de calificar).
    const content = await askPlain([
      { role: 'system', content: GRADING_SYSTEM_PROMPT },
      { role: 'user', content: buildAnswersUserMessage(answer1, answer2) },
    ])
    verdict = parseAnswerVerdicts(content)
    if (!verdict.parsed) modelFailed = true
  } catch {
    modelFailed = true
  }

  const answersScore = ((verdict.correct1 ? 1 : 0) + (verdict.correct2 ? 1 : 0)) / 2 * 5
  const score = Math.round(processScore + answersScore)

  const feedback = [
    `Proceso: ${processDesc}`,
    `Estructura 1: ${verdict.correct1 ? '✅ correcta' : '❌ incorrecta'}${verdict.reason1 ? ' — ' + verdict.reason1 : ''}.`,
    `Estructura 2: ${verdict.correct2 ? '✅ correcta' : '❌ incorrecta'}${verdict.reason2 ? ' — ' + verdict.reason2 : ''}.`,
    modelFailed
      ? '⚠️ No se pudo evaluar bien las respuestas con el modelo — este resultado puede ser menos preciso de lo normal.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return { score, feedback }
}
