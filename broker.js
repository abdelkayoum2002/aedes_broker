// ---- Imports ----
const aedes = require('aedes')()
const net = require('net')
const http = require('http')
const ws = require('websocket-stream')

// ---- TCP broker (local only, not used in Render) ----
const TCP_PORT = 1883
if (!process.env.PORT) {
  const tcpServer = net.createServer(aedes.handle)
  tcpServer.listen(TCP_PORT, () => {
    console.log(`🟢 TCP broker listening locally on mqtt://localhost:${TCP_PORT}`)
  })
}

// ---- WS broker (local + public on Render) ----
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888
const httpServer = http.createServer()

// WS endpoint is "/mqtt"
ws.createServer({ server: httpServer, path: '/mqtt' }, aedes.handle)

httpServer.listen(PORT, () => {
  console.log(`🟢 WS broker listening on ws://localhost:${PORT}/mqtt`)
  if (process.env.PORT) {
    console.log(`🌍 Public URL: wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/mqtt`)
  }
})

// ---- Logs for connections/messages ----
aedes.on('client', (client) => {
  console.log(`👤 Client connected: ${client.id}`)
})

aedes.on('clientDisconnect', (client) => {
  console.log(`❌ Client disconnected: ${client.id}`)
})

aedes.on('publish', (packet, client) => {
  if (client) {
    console.log(`📩 Message from ${client.id}: ${packet.topic} -> ${packet.payload.toString()}`)
  }
})
