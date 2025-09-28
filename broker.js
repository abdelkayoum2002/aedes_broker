const aedes = require('aedes')()
const net = require('net')
const http = require('http')
const ws = require('websocket-stream')
const mqttWildcard = require('mqtt-wildcard'); 
const jwt = require('jsonwebtoken');
require("dotenv").config();

// Constants
const JWT_SECRET = process.env.JWT_SECRET

// ---- WebSocket Server ---- //
const httpServer = http.createServer()
ws.createServer({ server: httpServer, path: '/mqtt' }, aedes.handle)

// ---- TCP Server ---- //
const tcpServer = net.createServer(aedes.handle)

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
// ---- Ports ---- //
const WS_PORT = process.env.NODE_ENV === 'production' ? process.env.PORT : 1884
const TCP_PORT = 1885

// ---- Start Servers ---- //
const httpReady = new Promise((resolve) =>
  httpServer.listen(WS_PORT, () => {
    console.log(`🟢 Aedes WebSocket broker listening on ws://localhost:${WS_PORT}/mqtt`)
    resolve()
  })
)

const tcpReady = new Promise((resolve) =>
  tcpServer.listen(TCP_PORT, () => {
    console.log(`🟢 Aedes TCP broker listening on mqtt://localhost:${TCP_PORT}`)
    resolve()
  })
)

Promise.all([httpReady, tcpReady]).then(() => {
  console.log('🚀 Both servers up, restoring retained messages...')
  restoreRetained()
})

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
aedes.on('clientDisconnect', (client) => {
  try {
    const clientId = client?.id || 'unknown';
    console.log(`🔌 Client disconnected: ${clientId}`);

    if (client && client.id) {
      // Get current status first
      const row = userDb.prepare(`
        SELECT status FROM MQTT WHERE client_id = ?
      `).get(client.id);

      if (row) {
        // Only overwrite if not already Disconnected or Deleted
        if (row.status !== 'Disconnected' && row.status !== 'Deleted') {
          userDb.prepare(`
            UPDATE MQTT SET status = ?, last_seen = datetime('now')
            WHERE client_id = ?
          `).run('Offline', client.id);
          console.log(`⚠️ Client ${clientId} marked as Disconnected`);
        } else {
          console.log(`🚫 Client ${clientId} status is ${row.status}, not overwriting`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error handling disconnect for client: ${client?.id}`, err.message);
  }
});

aedes.authorizeSubscribe = (client, sub, callback) => {
  // ✅ bypass check if super user
  if (client.super) {
    return callback(null, sub);
  }

  try {
    const role = client.role; // role must be set at auth time

    // fetch allowed subscription topics for this role
    const stmt = userDb.prepare(`
      SELECT topic
      FROM MQTT_Topics
      WHERE role = ?
        AND (action = 'sub' OR action = 'pub/sub')
    `);
    const rules = stmt.all(role); // array of { topic: '...' }

    // check if requested subscription topic matches at least one rule
    const allowed = rules.some(rule => mqttWildcard(sub.topic, rule.topic));

    if (allowed) {
      return callback(null, sub); // ✅ allowed
    }

    // ❌ not allowed → disconnect client
    return callback(new Error('Not authorized to subscribe'));
  } catch (err) {
    console.error("authorizeSubscribe error:", err);
    return callback(err); // also disconnects
  }
};
const insertOrUpdate = userDb.prepare(`
      INSERT INTO MQTTRetained (topic, payload, qos, retain)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(topic) DO UPDATE SET
        payload=excluded.payload,
        qos=excluded.qos,
        retain=excluded.retain,
        updated_at = datetime('now')
    `)
const deleteMsg = userDb.prepare(`DELETE FROM MQTTRetained WHERE topic=?`)
aedes.authorizePublish = async (client, packet, callback) => {
  if (client.super){
      if(packet.retain){
        if (!packet.payload || packet.payload.length === 0) {
          // empty payload with retain = delete retained
          try{
            deleteMsg.run(packet.topic)
            console.log(`🗑️ Deleted retained for ${packet.topic}`)
          }catch(err){
            console.error(`Failed to Deleted retained for ${packet.topic}: `,err);
          }
        } else {
          try{
            insertOrUpdate.run(packet.topic, packet.payload, packet.qos, 1)
            console.log(`💾 Stored retained for ${packet.topic}`)
          }catch(err){
            console.error(`Failed to Stored retained for ${packet.topic}: `,err)
          }
        }
      }
    return callback(null);
  }
  if (packet.topic === 'EmergencyStop') {
    const userId = client.user_id || client.id; // fallback to client.id
    packet.topic = `EmergencyStop/${userId}`;
    return callback(null);
  }
  try {
    const role = client.role;
    const stmt = userDb.prepare(`
      SELECT topic
      FROM MQTT_Topics
      WHERE role = ?
        AND (action = 'pub' OR action = 'pub/sub')
    `);
    console.log(role)
    console.log(packet.topic)
    const rules = stmt.all(role);
    
    const allowed = rules.some(rule => mqttWildcard(packet.topic, rule.topic));

    if (allowed) {
      if(packet.retain){
        if (!packet.payload || packet.payload.length === 0) {
          // empty payload with retain = delete retained
          try{
            deleteMsg.run(packet.topic)
            console.log(`🗑️ Deleted retained for ${packet.topic}`)
          }catch(err){
            console.error(`Failed to Deleted retained for ${packet.topic}: `,err);
          }
        } else {
          try{
            insertOrUpdate.run(packet.topic, packet.payload, packet.qos, 1)
            console.log(`💾 Stored retained for ${packet.topic}`)
          }catch(err){
            console.error(`Failed to Stored retained for ${packet.topic}: `,err)
          }
        }
      }
      return callback(null); // ✅ allowed
    }
    return callback(new Error('Not authorized to publish'));
  } catch (err) {
    console.error("authorizePublish error:",err)
    return callback(err);
  }
};


