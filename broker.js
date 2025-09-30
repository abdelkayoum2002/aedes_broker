// broker.js
const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const websocketStream = require('websocket-stream');

function startBroker() {
  const MQTT_TCP_PORT = process.env.MQTT_TCP_PORT || 1883;
  const WS_PORT = process.env.WS_PORT || 8083;
  const WS_PATH = process.env.WS_PATH || '/mqtt';

  // Native MQTT (TCP)
  const tcpServer = net.createServer(aedes.handle);
  tcpServer.listen(MQTT_TCP_PORT, () => {
    console.log(`🚀 MQTT TCP listening on ${MQTT_TCP_PORT}`);
  });

  // MQTT over WebSocket
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('MQTT over WebSocket endpoint');
  });
  websocketStream.createServer({ server: httpServer, path: WS_PATH }, aedes.handle);

  httpServer.listen(WS_PORT, () => {
    console.log(`🌐 MQTT WebSocket listening on ws://0.0.0.0:${WS_PORT}${WS_PATH}`);
  });

  // Logs
  aedes.on('client', (client) => console.log('🔌 Client connected:', client.id));
  aedes.on('clientDisconnect', (client) => console.log('❌ Client disconnected:', client.id));

  return aedes;
}

module.exports = startBroker;
