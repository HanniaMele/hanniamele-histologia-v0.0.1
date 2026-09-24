import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onError?: (message: string) => void
}
interface State {
  hasError: boolean
}

/**
 * Envuelve piezas que cargan datos externos (modelos .gltf/.glb). Si algo
 * truena adentro, en vez de tumbar TODO el árbol de React a pantalla negra,
 * esto solo deja de renderizar esa pieza y avisa hacia afuera por
 * `onError` — así App.tsx puede mostrar un mensaje visible con cuál
 * componente fue.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error): void {
    console.error('Error atrapado por ErrorBoundary:', error)
    this.props.onError?.(error.message)
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}
