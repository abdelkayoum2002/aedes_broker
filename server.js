// server.js
const express = require('express');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const path = require('path');

const { attachWebSocket, attachTCP, getBroker, closeBroker } = require('./broker');

const PORT = process.env.PORT || 3000;
const ENABLE_TCP_MQTT = process.env.ENABLE_TCP_MQTT === 'true';

// --- Express setup ---
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => res.json({ ok: true }));

// --- HTTP + Socket.IO ---
const httpServer = http.createServer(app);
const io = new IOServer(httpServer, { cors: { origin: '*' } });

// Forward MQTT → Socket.IO
const broker = getBroker();
broker.on('publish', (packet, client) => {
  const payload = packet.payload ? packet.payload.toString() : null;
  io.emit('mqtt-message', {
    topic: packet.topic,
    payload,
    qos: packet.qos,
    retain: packet.retain,
    clientId: client ? client.id : null
  });
});

// Allow Socket.IO → MQTT
io.on('connection', (socket) => {
  console.log('socket.io connected:', socket.id);

  socket.on('publish', ({ topic, payload, qos = 0, retain = false }) => {
    if (!topic) return;
    broker.publish(
      { topic, payload: Buffer.from(String(payload || '')), qos, retain },
      (err) => {
        if (err) console.error('socket.io publish error', err);
      }
    );
  });

  socket.on('disconnect', () => {
    console.log('socket.io disconnected:', socket.id);
  });
});

// --- Attach MQTT over WebSocket ---
attachWebSocket(httpServer, '/mqtt');

// --- Optional plain TCP MQTT ---
let tcpServer;
if (ENABLE_TCP_MQTT) {
  tcpServer = attachTCP(1883);
}

// --- Start server ---
httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server running on port ${PORT}`);
  console.log(`MQTT over WebSocket: ws://<host>:${PORT}/mqtt`);
});

// --- Graceful shutdown ---
function shutdown() {
  console.log('Shutting down...');
  httpServer.close();
  if (tcpServer) tcpServer.close();
  closeBroker(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
