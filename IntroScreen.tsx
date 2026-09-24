import { useEffect } from 'react'
import { warmupAgent } from './ollamaClient'

interface ModuleInfo {
  id: string
  label: string
  /** false = todavía no implementado: se ve pero no se puede entrar. */
  available: boolean
}

// Único lugar que hay que tocar para desbloquear un módulo nuevo: cambiar
// su `available` a true acá. El propio escenario 3D de ese módulo también
// tiene que existir y bloquear su interacción hasta que esté listo -- esto
// solo controla si se puede ENTRAR desde la presentación.
const MODULES: ModuleInfo[] = [
  { id: 'obtencion', label: '1. Obtención de la muestra', available: false },
  { id: 'fijacion', label: '2. Fijación', available: false },
  { id: 'inclusion', label: '3. Inclusión', available: false },
  { id: 'tincion', label: '4. Tinción', available: true },
]

interface IntroScreenProps {
  /** El estudiante eligió un módulo disponible -- listo para entrar a la escena. */
  onStart: (moduleId: string) => void
}

/**
 * Pantalla de presentación: se monta ENCIMA del <Canvas> (que ya está
 * cargando el laboratorio detrás, en paralelo -- ver App.tsx, el Canvas
 * nunca deja de montarse por esto) para que el estudiante no vea el
 * "salto" de las mallas/texturas apareciendo de a poco.
 *
 * De paso, aprovecha ese mismo rato de lectura para precalentar el modelo
 * de Ollama (ver warmupAgent) -- así, cuando el estudiante entra y le
 * escribe algo a Glía, el modelo ya está cargado en memoria y responde
 * rápido desde el primer mensaje.
 */
export function IntroScreen({ onStart }: IntroScreenProps) {
  useEffect(() => {
    warmupAgent()
  }, [])

  return (
    <div id="introScreen">
      <div id="introCard">
        <h1 id="introTitle">Laboratorio de histología</h1>
        <p id="introSubtitle">Elegí un módulo del método histológico para empezar.</p>
        <div id="introModules">
          {MODULES.map((mod) => (
            <button
              key={mod.id}
              className="introModuleCard"
              disabled={!mod.available}
              onClick={() => mod.available && onStart(mod.id)}
            >
              <span>{mod.label}</span>
              {!mod.available && <span className="introSoon">Próximamente</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
