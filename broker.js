
const aedes = require('aedes')()
const net = require('net')
const http = require('http')
const ws = require('websocket-stream')
const mqttWildcard = require('mqtt-wildcard'); 
const jwt = require('jsonwebtoken');
const {userDb} = require('./database');
require("dotenv").config();  

// Constants
const JWT_SECRET = process.env.JWT_SECRET
// ---- Ports ----
const TCP_PORT = 1885;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888
// ---- Servers ----
const tcpServer = net.createServer(aedes.handle)
const httpServer = http.createServer()
ws.createServer({ server: httpServer, path: '/mqtt' }, aedes.handle)
// ---- Promises ----
const tcpReady = new Promise((resolve) =>
  tcpServer.listen(TCP_PORT, () => {
    console.log(`🟢 TCP broker listening on mqtt://localhost:${TCP_PORT}`)
    resolve()
  })
)

const httpReady = new Promise((resolve) =>
  httpServer.listen(PORT, () => {
    console.log(`🟢 WS broker listening on ws://localhost:${PORT}/mqtt`)
    if (process.env.PORT) {
      console.log(`🌍 Public URL: wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/mqtt`)
    }
    resolve()
  })
)

// ---- Run after both are ready ----
Promise.all([tcpReady, httpReady]).then(() => {
  console.log('🚀 Both servers up, restoring retained messages...')
  restoreRetained()
})

// ---- Restore retained messages on startup ----
function restoreRetained() {
  const rows = userDb.prepare('SELECT topic, payload, qos FROM MQTTRetained').all()
  rows.forEach(row => {
    const packet = {
      topic: row.topic,
      payload: Buffer.from(row.payload),
      qos: row.qos || 0,
      retain: true
    }
    aedes.persistence.storeRetained(packet, (err) => {
      if (err) {
        console.error(`❌ Failed to restore retained for ${row.topic}:`, err)
      }
    })
  })
  console.log(`🔄 Restored ${rows.length} retained messages into broker memory`)
}
function disconnectMQTTDevice(clientId) {
  const client = aedes.clients[clientId];

  if (client) {
    // Close the TCP connection of that client
    client.close(() => {
      console.log(`MQTT client ${clientId} forcibly deleted`);
    });
  } else {
    console.log(`MQTT client ${clientId} not found`);
  }

  // Update DB regardless of whether client was online
  const result = userDb.prepare(`
    UPDATE MQTT
    SET status = 'Disconnected', last_seen = datetime('now')
    WHERE client_id = ?
  `).run(clientId);

  if (result.changes > 0) {
    console.log(`MQTT client ${clientId} disconectes secussfuly`);
    return true;
  } else {
    console.log(`MQTT client ${clientId} not found in DB`);
    return false;
  }
}

// 🔐 Authenticate clients using JWT
aedes.authenticate = (client, username, password, callback) => {
  const clientId = client.id;
  console.log(clientId)
  if (username === 'super') {
    client.super=true;
    console.log(`⚡ Super-user connected: ${clientId}`);
    return callback(null, true);
  }
  try {
    const token = password?.toString();
    if (!token) {
      return callback(new Error('❌ No token provided'), false);
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(decoded)
    if (decoded.type === 'Service') {
      client.role = decoded.role
      console.log(`✅ Service authenticated: ${client.role}`);
      return callback(null, true); // no DB lookup for services
    }
    // 1. Get device info
    const mqttRow = userDb.prepare(`
      SELECT client_id, device_id, status
      FROM MQTT
      WHERE client_id = ?
    `).get(clientId);

    console.log('mqttRow:', mqttRow);

    if (!mqttRow) {
      console.log(`❌ Unknown client_id: ${clientId}`);
      return callback(null, false);
    }

    // 🔎 Check MQTT status
    if (mqttRow.status === 'Disconnected') {
      console.log(`⛔ Disconnected mqtt devices tried to connect: ${mqttRow.client_id}`);
      return callback(null, false);
    }

    if (mqttRow.status === 'Deleted') {
      console.log(`🗑️ Deleted mqtt devices to connect: ${mqttRow.client_id}`);
      return callback(null, false);
    }
    userDb.prepare(`
      UPDATE MQTT SET status = ?, last_seen = datetime('now')
      WHERE client_id = ?
    `).run('Online', clientId);
    client.role=decoded.role;
    client.user_id=decoded.id;
    console.log(`✅ Authenticated:`, decoded.username);
    return callback(null, true);
  } catch (err) {
    console.error('❌ JWT Verification Error:', err.message);
    return callback(new Error('JWT auth failed'), false);
  }
};

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
