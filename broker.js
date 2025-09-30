// Simple Aedes broker supporting TCP + WebSocket, optional Redis persistence, and optional JWT auth.
// Configure via environment variables described below.

const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const WebSocket = require('ws');
const debug = require('debug')('aedes-fly');
const jwt = require('jsonwebtoken');

const REDIS_URL = process.env.REDIS_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const TCP_PORT = parseInt(process.env.TCP_PORT || '1883', 10);
const WS_PORT = parseInt(process.env.WS_PORT || process.env.PORT || '8080', 10); // Fly sets PORT for HTTP
const HOST = process.env.HOST || '0.0.0.0';

// Optional persistence
async function setupPersistence() {
  if (REDIS_URL) {
    debug('Using Redis persistence:', REDIS_URL);
    const { createClient } = require('redis');
    const redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => debug('Redis error', err));
    await redisClient.connect();
    const AedesPersistenceRedis = require('aedes-persistence-redis');
    const persistence = AedesPersistenceRedis({
      client: redisClient
    });
    aedes.persistence = persistence;
  } else {
    // default: in-memory via level (file) persistence
    debug('Using LevelDB local persistence (data/ folder)');
    const path = require('path');
    const levelPath = path.join(__dirname, 'data', 'level');
    const AedesLevel = require('aedes-persistence-level');
    aedes.persistence = AedesLevel({ path: levelPath });
  }
}

// Optional simple authentication using JWT token passed as MQTT username or in WebSocket "sec-websocket-protocol"
function authenticate(client, username, password, callback) {
  if (!JWT_SECRET) {
    // no auth enforced
    return callback(null, true);
  }

  // Accept JWT in username or password or in client.id as fallback
  let token = null;

  if (username && typeof username === 'string' && username.startsWith('jwt:')) {
    token = username.slice(4);
  } else if (password && password.length) {
    token = password.toString();
  } else if (username) {
    token = username;
  }

  if (!token) {
    const err = new Error('Authentication failed: no token');
    err.returnCode = 4;
    return callback(err, false);
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      const e = new Error('Authentication failed: invalid token');
      e.returnCode = 4;
      return callback(e, false);
    }
    // store decoded into client object
    client.user = decoded;
    callback(null, true);
  });
}

// Optional ACL check (simple example: allow all)
function authorizeSubscribe(client, sub, callback) {
  // sub: {topic: '...' , qos: 0}
  callback(null, sub);
}
function authorizePublish(client, packet, callback) {
  // packet.topic, packet.payload
  callback(null);
}

(async function main() {
  await setupPersistence();

  aedes.authenticate = authenticate;
  aedes.authorizeSubscribe = authorizeSubscribe;
  aedes.authorizePublish = authorizePublish;

  aedes.on('client', (client) => debug('Client connected:', client ? client.id : client));
  aedes.on('clientDisconnect', (client) => debug('Client disconnected:', client ? client.id : client));
  aedes.on('publish', (packet, client) => {
    if (client) debug('Message from', client.id, 'topic', packet.topic);
  });

  // TCP server (MQTT)
  const tcpServer = net.createServer(aedes.handle);
  tcpServer.listen(TCP_PORT, HOST, () => {
    debug(`MQTT (TCP) server listening on ${HOST}:${TCP_PORT}`);
    console.log(`MQTT (TCP) server listening on ${HOST}:${TCP_PORT}`);
  });

  // HTTP & WebSocket server for MQTT-over-WebSocket
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Aedes MQTT over WebSocket — OK\n');
  });

  const wss = new WebSocket.Server({ server: httpServer, path: '/mqtt' });

  wss.on('connection', function connection(ws, req) {
    // aedes ws handling
    const stream = WebSocket.createWebSocketStream(ws);
    aedes.handle(stream);
  });

  httpServer.listen(WS_PORT, HOST, () => {
    debug(`HTTP/WebSocket server listening on ${HOST}:${WS_PORT} (ws path: /mqtt)`);
    console.log(`HTTP/WebSocket server listening on ${HOST}:${WS_PORT} (ws path: /mqtt)`);
  });

  // graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    tcpServer.close();
    wss.close();
    httpServer.close();
    try {
      await aedes.close();
    } catch (e) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
