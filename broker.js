// broker.js
const aedes = require('aedes')();
const net = require('net');
const ws = require('websocket-stream');

function startBroker({ httpServer, tcpPort = 1883, wsPath = '/mqtt' } = {}) {
  // ---- TCP MQTT (local only) ----
  if (!process.env.PORT) { // only local
    const tcpServer = net.createServer(aedes.handle);
    tcpServer.listen(tcpPort, () => {
      console.log(`🟢 TCP broker listening locally on mqtt://localhost:${tcpPort}`);
    });
  }

  // ---- MQTT WebSocket ----
  if (httpServer) {
    ws.createServer({ server: httpServer, path: wsPath }, aedes.handle);
    console.log(`🟢 MQTT WS attached on path ${wsPath}`);
  }

  // ---- Broker events ----
  aedes.on('client', (client) => console.log(`👤 MQTT client connected: ${client.id}`));
  aedes.on('clientDisconnect', (client) => console.log(`❌ MQTT client disconnected: ${client.id}`));
  aedes.on('publish', (packet, client) => {
    if (client)
      console.log(`📩 ${client.id} → ${packet.topic}: ${packet.payload.toString()}`);
  });

  return aedes;
}

module.exports = { startBroker };
