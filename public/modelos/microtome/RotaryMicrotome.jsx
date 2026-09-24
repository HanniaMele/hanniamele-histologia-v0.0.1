import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * RotaryMicrotome
 * ----------------
 * Recreación estilizada de "rotatory_microtome.glb" usando únicamente
 * primitivas de three.js (cajas, cilindros, esferas, un toro).
 *
 * Cómo se sacaron las proporciones:
 *   El .glb original es UNA sola malla fusionada de ~293k vértices
 *   (típico de un modelo bajado de Sketchfab), así que no se puede separar
 *   "pieza por pieza" solo leyendo el archivo. En vez de eso, analicé la nube
 *   de puntos del modelo (bounding box global + proyecciones ortográficas
 *   frente/lado/arriba) para identificar la silueta real: un cuerpo/carcasa
 *   rectangular sobre una columna, un volante grande a un costado (eje en X),
 *   una perilla de ajuste fino al otro lado, una palanca de avance grueso
 *   arriba, el sujetador de la muestra arriba del cuerpo, y el portacuchillas
 *   al frente. Los colores (gris plata / azul / negro) salieron de la
 *   textura del material del glb.
 *
 * Estructura: cada subsistema (volante, sujetador, portacuchillas) es su
 * propio <group>, para que tengan un pivote local correcto por si luego
 * quieres animarlos (por ejemplo girar el volante).
 *
 * Uso:
 *   <RotaryMicrotome position={[0, 0, 0]} scale={1} spinWheel />
 */

// Paleta de colores (muestreada de la textura del modelo original)
const COLORS = {
  body: "#bfc4cb", // carcasa principal, gris plata
  bodyDark: "#9a9fa6", // columna / detalles hundidos
  wheel: "#2f6fad", // volante, acento azul
  knob: "#232323", // perillas y mangos, negro
  metal: "#d7d9dc", // ejes / vástagos, metal claro
  blade: "#e8eaec", // cuchilla, casi blanco
  specimen: "#c79a63", // bloque de muestra (madera/parafina)
};

export default function RotaryMicrotome({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  spinWheel = false,
  ...props
}) {
  const wheelRef = useRef();

  // Animación opcional: si spinWheel=true, el volante gira sobre su propio
  // eje (X local) como lo haría al accionar el microtomo manualmente.
  useFrame((_, delta) => {
    if (spinWheel && wheelRef.current) {
      wheelRef.current.rotation.x += delta * 1.2;
    }
  });

  return (
    <group position={position} rotation={rotation} scale={scale} {...props}>
      {/* ---------- Columna / base ---------- */}
      <mesh position={[0, 0.23, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.46, 0.46]} />
        <meshStandardMaterial color={COLORS.bodyDark} roughness={0.5} metalness={0.6} />
      </mesh>

      {/* Patas de apoyo en las 4 esquinas de la base */}
      {[
        [-0.2, -0.2],
        [0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.025, z]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.05, 12]} />
          <meshStandardMaterial color={COLORS.knob} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}

      {/* ---------- Carcasa principal ---------- */}
      <mesh position={[0, 0.785, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.05, 0.65, 0.95]} />
        <meshStandardMaterial color={COLORS.body} roughness={0.5} metalness={0.6} />
      </mesh>

      {/* Placa superior, ligeramente hundida, solo detalle visual */}
      <mesh position={[0, 1.135, 0]} castShadow>
        <boxGeometry args={[0.95, 0.05, 0.85]} />
        <meshStandardMaterial color={COLORS.bodyDark} roughness={0.5} metalness={0.6} />
      </mesh>

      {/* ---------- Volante (rueda de avance) ----------
          El cilindro por defecto tiene su eje a lo largo de Y; lo rotamos
          90° en Z para que el eje quede en X (el volante "mira" hacia el
          costado, como en el modelo real). Todo el subsistema vive dentro
          de un <group> propio para que wheelRef gire sobre un pivote limpio. */}
      <group ref={wheelRef} position={[-0.58, 0.62, -0.12]}>
        {/* llanta (tubo abierto) */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.06, 28, 1, true]} />
          <meshStandardMaterial color={COLORS.wheel} roughness={0.4} metalness={0.5} />
        </mesh>
        {/* aro (torus) que refuerza el borde del volante */}
        <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.42, 0.025, 10, 28]} />
          <meshStandardMaterial color={COLORS.wheel} roughness={0.4} metalness={0.5} />
        </mesh>
        {/* buje central */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.1, 16]} />
          <meshStandardMaterial color={COLORS.knob} roughness={0.5} metalness={0.4} />
        </mesh>
        {/* 4 rayos, repartidos cada 90° alrededor del eje X */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[(Math.PI / 2) * i, 0, 0]} castShadow>
            <boxGeometry args={[0.03, 0.38, 0.05]} />
            <meshStandardMaterial color={COLORS.wheel} roughness={0.4} metalness={0.5} />
          </mesh>
        ))}
        {/* mango para girar el volante a mano */}
        <mesh position={[0.03, 0.34, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.12, 12]} />
          <meshStandardMaterial color={COLORS.knob} roughness={0.6} metalness={0.3} />
        </mesh>
      </group>

      {/* eje que conecta el volante con la carcasa */}
      <mesh position={[-0.41, 0.62, -0.12]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.25, 12]} />
        <meshStandardMaterial color={COLORS.metal} roughness={0.3} metalness={0.8} />
      </mesh>

      {/* ---------- Palanca de avance grueso (arriba a la izq.) ---------- */}
      <mesh position={[-0.75, 0.95, -0.22]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.42, 10]} />
        <meshStandardMaterial color={COLORS.metal} roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[-0.96, 0.95, -0.22]} castShadow>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial color={COLORS.knob} roughness={0.6} metalness={0.3} />
      </mesh>

      {/* ---------- Perilla de ajuste fino (lado derecho) ---------- */}
      <mesh position={[0.6, 0.62, -0.12]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.14, 16]} />
        <meshStandardMaterial color={COLORS.knob} roughness={0.6} metalness={0.3} />
      </mesh>

      {/* ---------- Sujetador de la muestra (arriba, hacia atrás) ---------- */}
      <group position={[0.05, 1.11, 0.28]}>
        <mesh position={[0, 0.11, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.22, 12]} />
          <meshStandardMaterial color={COLORS.metal} roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.27, 0]} castShadow>
          <boxGeometry args={[0.26, 0.1, 0.16]} />
          <meshStandardMaterial color={COLORS.bodyDark} roughness={0.5} metalness={0.6} />
        </mesh>
        {/* bloque de muestra sostenido por el clamp */}
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[0.09, 0.07, 0.09]} />
          <meshStandardMaterial color={COLORS.specimen} roughness={0.8} metalness={0.05} />
        </mesh>
      </group>

      {/* ---------- Portacuchillas (al frente, abajo) ---------- */}
      <group position={[0.15, 0.62, 0.5]}>
        <mesh castShadow>
          <boxGeometry args={[0.32, 0.12, 0.22]} />
          <meshStandardMaterial color={COLORS.bodyDark} roughness={0.5} metalness={0.6} />
        </mesh>
        {/* cuchilla inclinada, como quedaría lista para cortar */}
        <mesh position={[0, 0.13, 0.09]} rotation={[-0.45, 0, 0]} castShadow>
          <boxGeometry args={[0.4, 0.16, 0.015]} />
          <meshStandardMaterial color={COLORS.blade} roughness={0.15} metalness={0.9} />
        </mesh>
        <mesh position={[0.19, 0, 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.08, 12]} />
          <meshStandardMaterial color={COLORS.knob} roughness={0.6} metalness={0.3} />
        </mesh>
      </group>
    </group>
  );
}
