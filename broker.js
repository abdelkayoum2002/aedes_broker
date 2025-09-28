// Simple Aedes broker that accepts MQTT over WebSocket (path: /mqtt)
// Designed to run on Render (uses process.env.PORT)

const aedes = require('aedes')();
const http = require('http');
const websocketStream = require('websocket-stream');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888;

// Basic client connect/disconnect logging (customize as needed)
aedes.on('client', (client) => {
  console.log('Client Connected:', client ? client.id : client);
});

aedes.on('clientDisconnect', (client) => {
  console.log('Client Disconnected:', client ? client.id : client);
});

aedes.on('publish', (packet, client) => {
  // ignore broker internal "$SYS" publishes (optional)
  if (client) {
    console.log(`PUBLISH from ${client.id} - topic: ${packet.topic} payload: ${packet.payload && packet.payload.toString()}`);
  }
});

// HTTP server to host websocket upgrades and an optional status page
const server = http.createServer((req, res) => {
  // Simple health endpoint
  if (req.url === '/health' || req.url === '/_health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', pid: process.pid, time: new Date().toISOString() }));
    return;
  }

  // Root info page
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html>
      <body style="font-family:system-ui,Arial">
        <h2>Aedes MQTT (ws) on Render</h2>
        <p>MQTT over WebSocket endpoint: <code>/mqtt</code></p>
        <p>Health: <a href="/health">/health</a></p>
        <p>Connect your MQTT client using ws://&lt;your-service&gt;:${PORT}/mqtt</p>
      </body>
      </html>`);
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

// Attach websocket-stream to the HTTP server, at path /mqtt
websocketStream.createServer({ server, path: '/mqtt' }, function (stream, request) {
  // Optionally check origin or auth headers here (request.headers)
  // Basic logging:
  const remote = request.socket.remoteAddress + ':' + request.socket.remotePort;
  console.log('New websocket connection from', remote, 'path=', request.url);
  aedes.handle(stream);
});

// Start listening
server.listen(PORT, () => {
  console.log(`Aedes MQTT over WebSocket listening on :${PORT}  (path: /mqtt)`);
});

// graceful shutdown
function shutdown() {
  console.log('Shutting down broker...');
  server.close(() => {
    aedes.close(() => {
      console.log('Broker closed. Exiting.');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
