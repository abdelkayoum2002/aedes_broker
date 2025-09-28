// server.js
require('dotenv').config();
const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const express = require('express');
const ws = require('websocket-stream');
const { Server } = require('socket.io');

// ---- Ports ----
const TCP_PORT = 1883; // local/internal MQTT TCP
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888; // public HTTP/WS/Socket.io

// ---- Express HTTP ----
const app = express();
app.use(express.json());

// Example REST endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok', mqttClients: aedes.clientsCount });
});

// ---- TCP MQTT (local only) ----
if (!process.env.PORT) {
  const tcpServer = net.createServer(aedes.handle);
  tcpServer.listen(TCP_PORT, () => {
    console.log(`🟢 TCP broker listening locally on mqtt://localhost:${TCP_PORT}`);
  });
}

// ---- Shared HTTP server ----
const httpServer = http.createServer(app);

// ---- MQTT WebSocket ----
ws.createServer({ server: httpServer, path: '/mqtt' }, aedes.handle);

// ---- Socket.io ----
const io = new Server(httpServer, {
  path: '/socket.io',
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('⚡ Socket.io client connected:', socket.id);

  socket.on('chat-message', (msg) => {
    console.log(`💬 Message from ${socket.id}: ${msg}`);
    io.emit('chat-message', msg); // broadcast to all
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket.io client disconnected:', socket.id);
  });
});

// ---- Start HTTP server ----
httpServer.listen(PORT, () => {
  console.log(`🌍 HTTP + MQTT WS + Socket.io listening on port ${PORT}`);
  if (process.env.PORT) {
    console.log(`🔗 Public MQTT WS URL: wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/mqtt`);
    console.log(`🔗 Public Socket.io URL: wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/socket.io/`);
    console.log(`🔗 REST API URL: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/status`);
  }
});

// ---- MQTT Broker events ----
aedes.on('client', (client) => console.log(`👤 MQTT client connected: ${client.id}`));
aedes.on('clientDisconnect', (client) => console.log(`❌ MQTT client disconnected: ${client.id}`));
aedes.on('publish', (packet, client) => {
  if (client)
    console.log(`📩 ${client.id} → ${packet.topic}: ${packet.payload.toString()}`);
});

// ---- Retained messages restore placeholder ----
function restoreRetained() {
  console.log('🔄 Retained messages restored (placeholder)');
}
