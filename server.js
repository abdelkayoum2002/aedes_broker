// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createMQTTBroker } = require('./broker');

// ---- Express app ----
const app = express();
app.use(express.json());

// Example REST endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok' });
});

// ---- HTTP server ----
const server = http.createServer(app);

// ---- Attach Aedes MQTT WS to the same HTTP server ----
createMQTTBroker({ httpServer: server, wsPath: '/mqtt', tcpPort: 1883 });

// ---- Socket.io ----
const io = new Server(server, { path: '/socket.io', cors: { origin: '*' } });
io.on('connection', (socket) => {
  console.log('⚡ Socket.io client connected:', socket.id);
  socket.on('disconnect', () => console.log('❌ Socket.io disconnected:', socket.id));
});

// ---- Start server ----
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888;
server.listen(PORT, () => {
  console.log(`🌍 HTTP + MQTT WS + Socket.io running on port ${PORT}`);
  if (process.env.PORT) {
    console.log(`🔗 Public MQTT WS: wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/mqtt`);
    console.log(`🔗 Public Socket.io: wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/socket.io/`);
  }
});
