import { useSyncExternalStore } from 'react'
import { imageHighlightBus } from './imageHighlightBus'
import { PREPARACION_ACTUAL } from './preparaciones'

/**
 * El "reflector" para la imagen del microscopio — equivalente a
 * <Highlighter> pero en 2D. Se suscribe a imageHighlightBus y, mientras haya
 * una estructura activa, dibuja un recuadro pulsante posicionado en % sobre
 * su contenedor (ver #scopeImageWrap en styles.css: tiene que ser
 * position:relative y del mismo tamaño que la imagen para que el % caiga en
 * el lugar correcto).
 */
export function ImageHighlight() {
  const active = useSyncExternalStore(imageHighlightBus.subscribe, () => imageHighlightBus.active)
  if (!active) return null

  const estructura = PREPARACION_ACTUAL.estructurasVisibles.find((e) => e.clave === active)
  if (!estructura) return null

  return (
    <div
      className="imgHighlightBox"
      style={{ left: `${estructura.x}%`, top: `${estructura.y}%` }}
      title={estructura.descripcion}
    />
  )
}
