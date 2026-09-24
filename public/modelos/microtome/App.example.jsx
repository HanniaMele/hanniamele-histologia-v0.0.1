import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import RotaryMicrotome from "./RotaryMicrotome";

/**
 * Ejemplo mínimo de cómo montar RotaryMicrotome dentro de un <Canvas>
 * de react-three-fiber. Solo para referencia rápida: cópialo/ajústalo
 * dentro de tu propia escena.
 */
export default function App() {
  return (
    <Canvas camera={{ position: [2.2, 1.6, 2.4], fov: 35 }} shadows>
      <hemisphereLight args={["#ffffff", "#444444", 1.2]} />
      <directionalLight position={[3, 5, 4]} intensity={2} castShadow />

      {/* spinWheel=true hace que el volante gire solo, como demo */}
      <RotaryMicrotome position={[0, 0, 0]} spinWheel />

      <OrbitControls target={[0, 0.55, 0]} />
      <Environment preset="studio" />
    </Canvas>
  );
}
