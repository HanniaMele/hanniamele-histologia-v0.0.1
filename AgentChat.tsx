import { useEffect, useRef, useState } from 'react'
import { runAgentTurn, type ChatMessage } from './ollamaClient'
import { agentNotices } from './agentNotices'
import { SYSTEM_PROMPT } from './agentPrompt'

/**
 * Panel de chat flotante. Guarda TODA la conversación (incluyendo el
 * mensaje de sistema y los mensajes de rol "tool") en `messages`, pero
 * solo le muestra al usuario los de usuario/asistente — los de "tool" son
 * ruido de implementación, no algo que Hannia (o quien use el lab) tenga
 * que leer.
 */
export function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', content: SYSTEM_PROMPT },
    // Saludo "de utilería": vive solo en el navegador, no le cuesta una
    // llamada al backend, pero hace que el chat no arranque vacío.
    {
      role: 'assistant',
      content: '¡Hola! Soy Glía. Voy a acompañarte por el laboratorio — pregúntame lo que sea, o dime "¿qué hago?" y empezamos.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // false = solo se ven los últimos 2 mensajes (conversación "fresca", el
  // chat ocupa poco). true = se ve todo el historial.
  const [showHistory, setShowHistory] = useState(false)
  // Panel completo ocultado con el botón "Ocultar" (queda un botoncito fijo
  // para volver a mostrarlo).
  const [hidden, setHidden] = useState(false)

  // ── Arrastrar el panel agarrando el encabezado ──
  // null = todavía en su posición default (abajo a la derecha, por CSS).
  // Una vez que lo arrastras, pasa a posición libre en pantalla.
  const panelRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setDragging(true)
  }

  // mousemove/mouseup en window (no solo en el encabezado): si sueltas el
  // mouse fuera del panel a medio arrastre, igual se queda donde lo dejaste
  // -- mismo patrón que ya usan PlayerControls.tsx y el selector de la
  // imagen del microscopio en App.tsx.
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const panel = panelRef.current
      const offset = dragOffset.current
      if (!panel || !offset) return
      const left = Math.max(4, Math.min(window.innerWidth - panel.offsetWidth - 4, e.clientX - offset.dx))
      const top = Math.max(4, Math.min(window.innerHeight - panel.offsetHeight - 4, e.clientY - offset.dy))
      setPos({ left, top })
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  // Avisos deterministas de la escena (p. ej. "te faltó el portaobjetos") —
  // llegan sin pasar por el modelo, ver agentNotices.ts.
  useEffect(() => {
    return agentNotices.subscribe((message) => {
      setMessages((m) => [...m, { role: 'assistant', content: message }])
    })
  }, [])

  async function send() {
    if (!input.trim() || busy) return
    const next = [...messages, { role: 'user', content: input } as ChatMessage]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const updated = await runAgentTurn(next)
      setMessages(updated)
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ No pude hablar con el agente: ${String(err)}` },
      ])
    } finally {
      setBusy(false)
    }
  }

  // Guarda el índice ORIGINAL de cada mensaje (para usarlo de key) antes de
  // recortar a los últimos 2 — así, al mostrar/ocultar el historial, React
  // reconoce cada mensaje por su identidad real y no reutiliza el burbuja
  // de un mensaje viejo mostrando el contenido de uno nuevo.
  //
  // content.trim() !== '': cuando Glía llama a una tool, el mensaje que
  // lleva la orden casi siempre trae content vacío (la respuesta en texto
  // llega en el mensaje SIGUIENTE) -- eso sigue viviendo en `messages`
  // porque el modelo lo necesita en el historial, pero no hay nada que
  // mostrarle a la usuaria ahí, así que no le pintamos una burbuja vacía.
  const visible = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '')
  const shown = showHistory ? visible : visible.slice(-2)

  if (hidden) {
    return (
      <button id="agentChatShow" onClick={() => setHidden(false)}>
        💬 Glía
      </button>
    )
  }

  return (
    <div
      id="agentChat"
      ref={panelRef}
      style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div id="agentChatHeader" onMouseDown={startDrag}>
        <span>Glía</span>
        <div id="agentChatHeaderBtns">
          <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowHistory((h) => !h)}>
            {showHistory ? 'Ocultar historial' : 'Historial'}
          </button>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setHidden(true)}>
            Ocultar
          </button>
        </div>
      </div>
      <div id="agentChatLog">
        {shown.map(({ m, i }) => (
          <div key={i} className={`agentMsg agentMsg-${m.role}`}>
            <strong>{m.role === 'user' ? 'Tú' : 'Agente'}:</strong> {m.content}
          </div>
        ))}
        {busy && <div className="agentMsg agentMsg-assistant">Agente: …pensando</div>}
      </div>
      <div id="agentChatInput">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder="Pregúntale algo al agente…"
          disabled={busy}
        />
        <button onClick={send} disabled={busy}>Enviar</button>
      </div>
    </div>
  )
}
