// server.js
// Express + Socket.IO + Aedes MQTT broker (MQTT over WebSocket for Render)
// Usage: PORT=10000 node server.js
// Optional: ENABLE_TCP_MQTT=true node server.js  -> tries to open TCP 1883 (may not be allowed on Render)

const express = require('express');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const aedes = require('aedes')();
const net = require('net');
const WebSocket = require('ws');
const websocketStream = require('websocket-stream'); // npm i websocket-stream

const app = express();

// Basic HTTP endpoints
app.use(express.json());
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html'); // simple demo page (create below) or replace with your UI
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Create HTTP server used both by Express and by WebSocket MQTT server
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);

// Socket.IO attached to same HTTP server
const io = new IOServer(httpServer, {
  // options (if needed)
  cors: { origin: '*' }
});

// Forward MQTT publishes to socket.io clients
aedes.on('publish', (packet, client) => {
  // ignore broker's internal $SYS packets if you want:
  // if (packet.topic && packet.topic.startsWith('$SYS')) return;
  try {
    const payload = packet.payload ? packet.payload.toString() : null;
    io.emit('mqtt-message', {
      topic: packet.topic,
      payload,
      qos: packet.qos,
      retain: packet.retain,
      clientId: client ? client.id : null
    });
  } catch (err) {
    console.error('Error forwarding MQTT -> socket.io', err);
  }
});

// Allow socket.io clients to publish to MQTT broker
io.on('connection', (socket) => {
  console.log('socket.io client connected:', socket.id);

  socket.on('publish', ({ topic, payload, qos = 0, retain = false }) => {
    if (!topic) return socket.emit('error', 'topic required');
    aedes.publish({ topic, payload: Buffer.from(String(payload || '')), qos, retain }, (err) => {
      if (err) {
        console.error('Error publishing from socket.io to MQTT', err);
        socket.emit('publish-error', err.message || 'publish failed');
      } else {
        socket.emit('publish-ok', { topic });
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('socket.io client disconnected:', socket.id);
  });
});

// --- WebSocket MQTT (MQTT over WS) ---
// Path: /mqtt
const wss = new WebSocket.Server({ server: httpServer, path: '/mqtt' });
wss.on('connection', (ws, req) => {
  // convert ws to a stream aedes can handle
  const stream = websocketStream(ws);
  aedes.handle(stream);
});

// Optionally open plain TCP MQTT port (1883) if environment allows it
if (process.env.ENABLE_TCP_MQTT === 'true') {
  const MQTT_TCP_PORT = process.env.MQTT_TCP_PORT || 1883;
  const tcpServer = net.createServer(aedes.handle);
  tcpServer.listen(MQTT_TCP_PORT, () => {
    console.log(`MQTT (TCP) server listening on port ${MQTT_TCP_PORT}`);
  });
  tcpServer.on('error', (err) => {
    console.error('TCP MQTT server error', err.message);
  });
} else {
  console.log('TCP MQTT server disabled. Using MQTT over WebSocket only (path: /mqtt). Set ENABLE_TCP_MQTT=true to try enabling TCP 1883.');
}

// Start HTTP server (this is the port Render expects)
httpServer.listen(PORT, () => {
  console.log(`HTTP (Express + Socket.IO + MQTT over WS) listening on port ${PORT}`);
  console.log(`MQTT over WebSocket path: ws://<your-host>:${PORT || '<env PORT>'}/mqtt`);
});

// graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  httpServer.close();
  aedes.close(() => {
    console.log('Aedes closed');
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
