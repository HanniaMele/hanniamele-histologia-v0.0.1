import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LabRoom } from './LabRoom'
import { PlayerControls } from './PlayerControls'
import { Microscope } from './Microscope'
import { Microtome } from './Microtome'
import { SlideCase } from './SlideCase'
import { JarRow } from './JarRow'
import { ErrorBoundary } from './ErrorBoundary'
import { slideBus } from './slideBus'
import { Highlighter } from './Highlighter'
import { AgentChat } from './AgentChat'
import { IntroScreen } from './IntroScreen'
import { ImageHighlight } from './ImageHighlight'
import { imageHighlightBus } from './imageHighlightBus'
import { agentNotices } from './agentNotices'
import { PREPARACION_ACTUAL } from './preparaciones'
import { examBus } from './examBus'
import { gradeExam, type ExamResult as ExamResultData } from './examGrading'
import { ExamPrompt, ExamAnswerForm, ExamResult } from './ExamUI'

// La imagen de la preparación vive en public/ — Vite la sirve tal cual, igual
// que los modelos en ./modelos/.
const SCOPE_IMAGE = './imagenes/albcre_he.webp'

const EYE_H = 1.62 // misma altura de cámara que usamos en la versión vainilla

/** Tecla P: muestra la posición actual de la cámara — para calibrar posiciones a mano. */
function CoordReadout({ onReadout }: { onReadout: (msg: string) => void }) {
  const { camera } = useThree()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p') return
      const p = camera.position
      onReadout(`📍 x=${p.x.toFixed(2)}  y=${p.y.toFixed(2)}  z=${p.z.toFixed(2)} (tecla P)`)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [camera, onReadout])
  return null
}

export default function App() {
  // false = todavía en la presentación (IntroScreen), tapando el Canvas
  // mientras carga detrás. El Canvas se monta SIEMPRE, con o sin esto en
  // true -- lo único que cambia es si se ve.
  const [started, setStarted] = useState(false)

  // Compartido entre LabRoom (lo llena con sus mallas) y PlayerControls (lo
  // usa para las colisiones) — un ref, no useState, porque cambia sin
  // necesidad de disparar un re-render de React.
  const collidables = useRef<THREE.Object3D[]>([])

  const [errors, setErrors] = useState<Record<string, string>>({})
  const setError = (key: string) => (msg: string) => setErrors((e) => ({ ...e, [key]: msg }))

  const [coords, setCoords] = useState<string | null>(null)

  // Globo con la concentración de alcohol del frasco bajo el mouse.
  const [jarTip, setJarTip] = useState<{ label: string; x: number; y: number } | null>(null)

  // Imagen de la preparación: se abre al hacer clic en el microscopio cuando
  // ya hay un portaobjetos en la platina.
  const [scopeImage, setScopeImage] = useState(false)

  // ── Modo prueba ──────────────────────────────────────────────────────
  // examMode espeja examBus.active en estado de React (para poder
  // re-renderizar) -- ver examBus.ts para por qué JarRow necesita el
  // singleton aparte de esto.
  const [examMode, setExamMode] = useState(false)
  // Se muestra al cerrar la imagen, la primera vez que se ve teñida CON
  // Glía todavía disponible (o sea, fuera del propio modo prueba).
  const [examPrompt, setExamPrompt] = useState(false)
  const [examAnswer1, setExamAnswer1] = useState('')
  const [examAnswer2, setExamAnswer2] = useState('')
  const [grading, setGrading] = useState(false)
  const [examResult, setExamResult] = useState<ExamResultData | null>(null)
  // Cambiarlo remonta <SlideCase>/<JarRow>/<PlayerControls> (via key) --
  // la forma más simple de dejar esa parte de la escena como recién
  // arrancada, sin tener que reconstruir a mano cada pieza de estado
  // interno de esos 3 componentes.
  const [resetKey, setResetKey] = useState(0)

  function resetStainingState() {
    slideBus.group = null
    slideBus.held = false
    slideBus.claimedByJar = null
    slideBus.stained = false
    slideBus.onScope = false
  }

  // Cierra el visor Y apaga cualquier recuadro que Glía haya dejado puesto
  // sobre la imagen (senalar_en_imagen) — si no, reabrir mostraría el
  // recuadro de la última estructura señalada, aunque ya no venga al caso.
  const closeScope = () => {
    setScopeImage(false)
    imageHighlightBus.set(null)
    setSelStart(null)
    setSelNow(null)
    // Recién ahí, después de ver la preparación teñida con Glía todavía
    // disponible, se le ofrece la prueba -- nunca en medio del propio
    // intento calificado (ahí "cerrar" sin mandar las 2 respuestas solo
    // vuelve a la escena, ver ExamAnswerForm).
    if (!examMode) setExamPrompt(true)
  }

  function declineExam() {
    setExamPrompt(false)
  }

  function acceptExam() {
    resetStainingState()
    examBus.active = true
    examBus.log = []
    setExamMode(true)
    setExamPrompt(false)
    setExamResult(null)
    setExamAnswer1('')
    setExamAnswer2('')
    setResetKey((k) => k + 1)
  }

  // Mismo reinicio que acceptExam, pero sin tocar examMode/examBus.active
  // (ya está en true) -- para reintentar sin salir del modo prueba.
  function retryExam() {
    resetStainingState()
    examBus.log = []
    setExamResult(null)
    setExamAnswer1('')
    setExamAnswer2('')
    setResetKey((k) => k + 1)
  }

  function exitExamToPractice() {
    resetStainingState()
    examBus.active = false
    examBus.log = []
    setExamMode(false)
    setExamResult(null)
    setResetKey((k) => k + 1)
  }

  async function submitExamAnswers() {
    setGrading(true)
    try {
      const result = await gradeExam(examBus.log, examAnswer1, examAnswer2)
      setExamResult(result)
      closeScope()
    } finally {
      setGrading(false)
    }
  }

  // Selección DEL ESTUDIANTE sobre la imagen: clic para fijar la primera
  // esquina, mueve el mouse (el recuadro va creciendo desde ahí, sin tener
  // que mantener el botón apretado), y un segundo clic cierra el rectángulo.
  // (Un primer intento con "mantén y arrastra" chocaba con el drag nativo
  // del navegador sobre <img> -- el navegador agarraba la imagen misma en
  // vez de dejarnos manejar el gesto.) No hay ningún modelo de visión de por
  // medio: se calcula qué estructura(s) curadas (de preparaciones.ts) caen
  // DENTRO del rectángulo, y si ninguna cae adentro, la más cercana a su
  // centro. Glía contesta con su descripción real, directo (sin pasar por
  // Ollama, ver agentNotices.ts) para que funcione igual de bien sin
  // importar qué tan confiable esté el modelo hoy.
  const [selStart, setSelStart] = useState<{ x: number; y: number } | null>(null)
  const [selNow, setSelNow] = useState<{ x: number; y: number } | null>(null)

  function pctFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    }
  }

  function resolveSelection(a: { x: number; y: number }, b: { x: number; y: number }) {
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const y2 = Math.max(a.y, b.y)
    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2

    const inside = PREPARACION_ACTUAL.estructurasVisibles.filter(
      (s) => s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2,
    )
    // Nada cayó adentro (o cayó más de una): nos quedamos con la más cercana
    // al centro del rectángulo -- con un clic-clic casi en el mismo punto,
    // esto se reduce a "la más cercana al punto donde diste clic".
    const pool = inside.length > 0 ? inside : PREPARACION_ACTUAL.estructurasVisibles
    let nearest = pool[0]
    let bestDist = Infinity
    for (const s of pool) {
      const d = Math.hypot(s.x - cx, s.y - cy)
      if (d < bestDist) { bestDist = d; nearest = s }
    }
    if (!nearest) return

    imageHighlightBus.set(nearest.clave)
    agentNotices.send(`¡Buen ojo! Eso que señalaste: ${nearest.descripcion}`)
  }

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation() // no cerrar el visor al seleccionar
    const p = pctFromEvent(e)
    if (!selStart) {
      // Primer clic: fija la primera esquina y empieza a mostrar el recuadro.
      setSelStart(p)
      setSelNow(p)
    } else {
      // Segundo clic: cierra el rectángulo con este punto y resuelve.
      resolveSelection(selStart, p)
      setSelStart(null)
      setSelNow(null)
    }
  }

  const handleImageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selStart) return
    setSelNow(pctFromEvent(e))
  }

  // Escape: si hay una selección a medias (ya diste el primer clic), la
  // cancela nada más. Si no, cierra todo el visor.
  useEffect(() => {
    if (!scopeImage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selStart) {
        setSelStart(null)
        setSelNow(null)
        return
      }
      closeScope()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeImage, selStart])

  return (
    <>
      <Canvas camera={{ position: [0, EYE_H, 3], fov: 62, near: 0.05, far: 100 }} shadows>
        <color attach="background" args={['#0a0f18']} />
        <fog attach="fog" args={['#0a0f18', 8, 18]} />
        <hemisphereLight args={['#bcd6ff', '#2b3138', 0.9]} />
        <ambientLight color="#3a4a63" intensity={0.55} />
        <directionalLight position={[6, 9, 5]} intensity={1.5} color="#fff3e0" castShadow />
        <pointLight position={[-2, 2.7, -2.5]} color="#fff2d8" intensity={20} distance={14} decay={1.8} />
        <pointLight position={[2, 2.7, 2.5]} color="#fff2d8" intensity={20} distance={14} decay={1.8} />

        <Suspense fallback={null}>
          <ErrorBoundary onError={setError('lab')}>
            <LabRoom collidables={collidables} />
          </ErrorBoundary>
        </Suspense>

        <Suspense fallback={null}>
          <ErrorBoundary onError={setError('microscope')}>
            <Microscope
              onClick={() => {
                // Solo si hay un portaobjetos en la platina (y no uno en la mano
                // — ese clic sería para apoyarlo).
                if (!slideBus.onScope || slideBus.held) return
                if (slideBus.stained) {
                  setScopeImage(true)
                } else if (!examMode) {
                  // Todavía no pasó por H&E (sin el puntito morado): no hay
                  // nada real que mostrar todavía. Se lo dice Glía en el
                  // chat, en vez de abrir un visor vacío o con datos falsos.
                  // En modo prueba esto se calla -- sin correcciones, ver
                  // examBus.ts.
                  agentNotices.send(
                    'Todavía no está teñida — le falta pasar por toda la fila de frascos, terminando en el de H&E, antes de que se pueda ver algo al microscopio.',
                  )
                }
              }}
            />
          </ErrorBoundary>
        </Suspense>

        <Suspense fallback={null}>
          <ErrorBoundary onError={setError('slides')}>
            {/* key={resetKey}: al arrancar/reintentar la prueba, remonta
                fresco -- portaobjetos suelto, nada en mano. */}
            <SlideCase key={resetKey} />
          </ErrorBoundary>
        </Suspense>

        <Suspense fallback={null}>
          <ErrorBoundary onError={setError('microtome')}>
            <Microtome />
          </ErrorBoundary>
        </Suspense>

        <Suspense fallback={null}>
          <ErrorBoundary onError={setError('jars')}>
            <JarRow key={resetKey} onTip={setJarTip} />
          </ErrorBoundary>
        </Suspense>

        {/* Recién se monta al arrancar el módulo: mientras se ve la
            presentación no hace falta escuchar WASD/arrastre ni fijar la
            cámara en el spawn -- el Canvas está tapado igual. key={resetKey}
            además de vuelta al spawn cada vez que arranca/reintenta la
            prueba, para empezar el intento siempre desde el mismo lugar. */}
        {started && (
          <PlayerControls key={resetKey} bounds={4.5} spawn={[0, EYE_H, 3]} collidables={collidables} />
        )}
        <CoordReadout onReadout={setCoords} />
        <Highlighter />
      </Canvas>

      {/* Tapa el Canvas (que ya está cargando el laboratorio detrás) hasta
          que el estudiante elige un módulo disponible. */}
      {!started && <IntroScreen onStart={() => setStarted(true)} />}

      {/* Sin Glía durante el modo prueba -- ver examBus.ts. */}
      {started && !examMode && <AgentChat />}

      {coords && <div id="coordReadout">{coords}</div>}

      {jarTip && (
        <div id="jarTip" style={{ left: jarTip.x + 16, top: jarTip.y + 16 }}>
          {jarTip.label}
        </div>
      )}

      {scopeImage && (
        <div id="scopeView" className={examMode ? 'scopeViewExam' : undefined} onClick={examMode ? undefined : closeScope}>
          {/* #scopeImageWrap se ajusta al tamaño real de la imagen (no al
              del viewport) para que ImageHighlight y el rectángulo de
              selección se posicionen en % relativos a la imagen misma. En
              modo prueba no hay selección libre ni pistas -- solo mirar y
              contestar en <ExamAnswerForm>. */}
          <div
            id="scopeImageWrap"
            onClick={examMode ? undefined : handleImageClick}
            onMouseMove={examMode ? undefined : handleImageMouseMove}
          >
            <img src={SCOPE_IMAGE} alt="Preparación vista al microscopio" draggable={false} />
            {!examMode && <ImageHighlight />}
            {!examMode && selStart && selNow && (
              <div
                id="scopeSelectBox"
                style={{
                  left: `${Math.min(selStart.x, selNow.x)}%`,
                  top: `${Math.min(selStart.y, selNow.y)}%`,
                  width: `${Math.abs(selNow.x - selStart.x)}%`,
                  height: `${Math.abs(selNow.y - selStart.y)}%`,
                }}
              />
            )}
          </div>
          {examMode ? (
            <ExamAnswerForm
              answer1={examAnswer1}
              answer2={examAnswer2}
              onChange1={setExamAnswer1}
              onChange2={setExamAnswer2}
              onSubmit={submitExamAnswers}
              submitting={grading}
            />
          ) : (
            <button
              id="scopeClose"
              onClick={(e) => { e.stopPropagation(); closeScope() }}
            >
              ✕ cerrar
            </button>
          )}
        </div>
      )}

      {examPrompt && <ExamPrompt onAccept={acceptExam} onDecline={declineExam} />}

      {examResult && (
        <ExamResult
          score={examResult.score}
          feedback={examResult.feedback}
          onRetry={retryExam}
          onExit={exitExamToPractice}
        />
      )}

      {Object.entries(errors).map(([key, msg]) => (
        <div key={key} id="errorBanner" style={{ top: Object.keys(errors).indexOf(key) * 40 }}>
          ⚠️ No se pudo cargar "{key}" ({msg}) — revisa la ruta y los archivos en ./modelos/.
        </div>
      ))}
    </>
  )
}
