const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
const httpServer = require('http').createServer();
const ws = require('websocket-stream');
const pump = require('pump');

const PORT = process.env.PORT || 1883;
const WEBSOCKET_PORT = process.env.WS_PORT || 8080;

// MQTT broker instance
const broker = aedes;


// Event handlers
broker.on('client', function (client) {
  console.log(`Client connected: ${client.id}`);
});

broker.on('clientDisconnect', function (client) {
  console.log(`Client disconnected: ${client.id}`);
});


broker.on('clientError', function (client, err) {
  console.log(`Client error ${client.id}:`, err.message);
});

broker.on('connectionError', function (client, err) {
  console.log('Connection error:', err.message);
});

// TCP Server for MQTT
server.listen(PORT, function () {
  console.log(`AEDES MQTT Broker running on port ${PORT}`);
  console.log(`Connect using: mqtt://localhost:${PORT}`);
});

// WebSocket Server for MQTT over WebSockets
ws.createServer({ 
  server: httpServer,
  perMessageDeflate: false
}, pump.bind(null, broker.handle));

httpServer.listen(WEBSOCKET_PORT, function () {
  console.log(`MQTT WebSocket server running on port ${WEBSOCKET_PORT}`);
  console.log(`Connect using: ws://localhost:${WEBSOCKET_PORT}`);
});

// Health check endpoint
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    broker: 'aedes',
    clients: broker.clients ? Object.keys(broker.clients).length : 0,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'AEDES MQTT Broker',
    version: require('./package.json').version || '1.0.0',
    mqtt_port: PORT,
    websocket_port: WEBSOCKET_PORT,
    endpoints: {
      mqtt: `mqtt://localhost:${PORT}`,
      websocket: `ws://localhost:${WEBSOCKET_PORT}`,
      health: '/health',
      stats: '/stats'
    }
  });
});

app.get('/stats', (req, res) => {
  const stats = broker.stats ? broker.stats : {
    clients: broker.clients ? Object.keys(broker.clients).length : 0,
    subscriptions: 0,
    publications: 0
  };
  
  res.json({
    ...stats,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Use a different port for HTTP health checks (Render requirement)
const HTTP_PORT = process.env.HTTP_PORT || 3000;
app.listen(HTTP_PORT, () => {
  console.log(`HTTP health server running on port ${HTTP_PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = { broker, server, httpServer };