// server/index.js
//
// ¿Por qué necesitamos este archivo si ya tenemos React corriendo con Vite?
//
// Analogía: Ollama es como un cocinero (el modelo de lenguaje) que vive en
// una cocina (tu computadora, puerto 11434). El navegador (donde corre
// React, típicamente en http://localhost:5173) es como un cliente en el
// comedor: por seguridad, los navegadores tienen una regla que dice "no
// puedes entrar directo a la cocina de OTRA dirección sin permiso" — eso
// se llama CORS. Ollama, por defecto, no le da ese permiso al origen de
// Vite.
//
// La solución: un "mesero" (este servidor) que sí puede hablar libremente
// con la cocina — porque ambos son procesos de servidor, no páginas de
// navegador, y CORS solo aplica a navegadores — y que el navegador solo
// tiene que hablar con el mesero. Este mesero es también donde, más
// adelante, pondrías cualquier API key si un día cambias de Ollama a un
// modelo en la nube (Anthropic, OpenAI, ...) — nunca directo en el código
// de React, porque el navegador expone todo lo que hay ahí a quien abra
// las herramientas de desarrollador.

import http from 'node:http'

const OLLAMA_URL = 'http://localhost:11434/api/chat'

// Modelo activo: gemma4:e2b.
//
// ⚠️ IMPORTANTE: la familia Gemma NO soporta tool calling en Ollama. Con
// este modelo, resaltar_objeto y explicar_imagen_microscopio casi nunca
// llegan como tool_calls real -- el agente responde solo en texto. Las
// redes de seguridad en ollamaClient.ts (detectLocationTarget,
// detectStartTarget, extractTextToolCall) cubren buena parte de eso para
// "dónde está X" / "cómo empiezo", pero explicar_imagen_microscopio y
// senalar_en_imagen (sin fallback) quedan mudas. El modo prueba (examGrading.ts)
// usa askPlain, sin tools, así que calificar SÍ funciona igual con este modelo.
//
// Otros modelos ya descargados: 'llama3.2:3b' (2 GB, el mejor balance
// encontrado hasta ahora -- tool calling confiable, coherente, rápido),
// 'qwen3.5:latest' (6.6 GB, coherente pero lento), 'qwen3.5:2b' y
// 'qwen3.5:0.8b' (rápidos, pierden coherencia en varios turnos), 'qwen3-vl:8b'.
const MODEL = 'gemma4:e2b'

const PORT = 3001

// Le da permiso al navegador (otro "origen": mismo puerto de la app de
// Ollama no, el de Vite) de hablarle a este servidor. Sin esto, el
// navegador bloquearía la respuesta aunque el servidor sí la mande.
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const server = http.createServer(async (req, res) => {
  setCors(res)

  // El navegador manda una petición "OPTIONS" de reconocimiento antes del
  // POST real (parte del protocolo CORS) — hay que responderla vacía y OK,
  // o el POST real nunca se llega a mandar.
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    res.writeHead(404)
    res.end('No encontrado')
    return
  }

  // Node no junta el body de la petición por nosotros como haría Express —
  // lo armamos a mano leyendo los "chunks" que van llegando hasta que la
  // petición termina.
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', async () => {
    try {
      const { messages, tools } = JSON.parse(body)

      const ollamaRes = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools,
          stream: false, // más simple para empezar: la respuesta completa de una vez, no en pedazos
        }),
      })

      if (!ollamaRes.ok) {
        const errText = await ollamaRes.text()
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Ollama respondió ${ollamaRes.status}: ${errText}` }))
        return
      }

      const data = await ollamaRes.json()

      // Log de depuracion: asi vemos en ESTA terminal exactamente que
      // contesto el modelo -- si trae tool_calls (SI decidio usar una
      // tool) o solo content (NO uso ninguna, respondio en texto plano).
      // Una vez que todo funcione bien, puedes borrar este bloque si ya
      // no lo necesitas.
      console.log('--- respuesta de Ollama ---')
      console.log(JSON.stringify(data.message, null, 2))
      console.log('---------------------------')

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    } catch (err) {
      // Esto es lo que nos va a decir QUE truena exactamente -- antes no
      // se imprimia nada aqui, por eso no se veia nada util en la terminal.
      console.error('--- ERROR en el backend del agente ---')
      console.error(err)
      console.error('---------------------------------------')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`Backend del agente escuchando en http://localhost:${PORT}`)
  console.log(`  (reenviando a Ollama en ${OLLAMA_URL}, modelo "${MODEL}")`)
})
