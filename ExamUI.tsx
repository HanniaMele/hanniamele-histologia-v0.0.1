/**
 * Las 3 pantallas del "modo prueba" — ver App.tsx para la orquestación
 * (cuándo se muestra cada una y qué hacen los botones). Separadas de App.tsx
 * porque es harto JSX de UI y App.tsx ya es bastante largo.
 */

interface ExamPromptProps {
  onAccept: () => void
  onDecline: () => void
}

/** Aparece al cerrar la imagen del microscopio, la primera vez que se ve teñida (con Glía). */
export function ExamPrompt({ onAccept, onDecline }: ExamPromptProps) {
  return (
    <div id="examOverlay">
      <div id="examCard">
        <p id="examCardMain">Ya viste la preparación teñida — estás listo para la prueba. ¿Querés tomarla?</p>
        <p id="examCardNote">
          En la prueba repetís el proceso de tinción desde cero, pero sin poder hablar con Glía: tenés que
          hacerlo solo, con lo que ya aprendiste. Al final, vas a describir 2 partes de lo que ves en la
          imagen y vas a recibir una puntuación.
        </p>
        <div id="examCardBtns">
          <button onClick={onDecline}>Todavía no</button>
          <button onClick={onAccept} className="examPrimaryBtn">Sí, tomarla</button>
        </div>
      </div>
    </div>
  )
}

interface ExamAnswerFormProps {
  answer1: string
  answer2: string
  onChange1: (v: string) => void
  onChange2: (v: string) => void
  onSubmit: () => void
  submitting: boolean
}

/** Reemplaza el chat libre + selección sobre la imagen cuando estás en modo prueba. */
export function ExamAnswerForm({ answer1, answer2, onChange1, onChange2, onSubmit, submitting }: ExamAnswerFormProps) {
  const canSubmit = answer1.trim() !== '' && answer2.trim() !== '' && !submitting
  return (
    <div id="examAnswerForm" onClick={(e) => e.stopPropagation()}>
      <p id="examAnswerPrompt">Describí 2 partes de lo que ves en la imagen:</p>
      <label>
        Estructura 1
        <input value={answer1} onChange={(e) => onChange1(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Estructura 2
        <input value={answer2} onChange={(e) => onChange2(e.target.value)} disabled={submitting} />
      </label>
      <button onClick={onSubmit} disabled={!canSubmit} className="examPrimaryBtn">
        {submitting ? 'Calificando…' : 'Enviar'}
      </button>
    </div>
  )
}

interface ExamResultProps {
  score: number
  feedback: string
  onRetry: () => void
  onExit: () => void
}

/** Pantalla final: puntaje + retroalimentación, con opción de reintentar o volver a practicar con Glía. */
export function ExamResult({ score, feedback, onRetry, onExit }: ExamResultProps) {
  return (
    <div id="examOverlay">
      <div id="examCard">
        <p id="examScoreLabel">Puntuación</p>
        <p id="examScoreValue">{score}/10</p>
        <p id="examCardNote">{feedback}</p>
        <div id="examCardBtns">
          <button onClick={onExit}>Volver a practicar con Glía</button>
          <button onClick={onRetry} className="examPrimaryBtn">Intentar de nuevo</button>
        </div>
      </div>
    </div>
  )
}
