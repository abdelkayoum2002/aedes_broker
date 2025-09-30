// server.js = entry point
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const startBroker = require('./broker');

// Start broker inside same process
startBroker();

const PORT = process.env.PORT || 3000;
const MQTT_WS_URL = process.env.MQTT_WS_URL || 'ws://localhost:8083/mqtt';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// API route
app.get('/', (req, res) => res.send('HTTP + Socket.io + MQTT broker is running'));

// MQTT client (connect to local broker via WS)
const mqttClient = mqtt.connect(MQTT_WS_URL);

mqttClient.on('connect', () => {
  console.log(`🔗 Connected to local MQTT broker at ${MQTT_WS_URL}`);
  mqttClient.subscribe('silos/+/alerts');
});

mqttClient.on('message', (topic, payload) => {
  const msg = payload.toString();
  console.log('📩 MQTT ->', topic, msg);
  io.emit('mqtt', { topic, msg });
});

// socket.io bridge
io.on('connection', (socket) => {
  console.log('🟢 socket.io client connected', socket.id);

  socket.on('publish', ({ topic, msg }) => mqttClient.publish(topic, msg));
  socket.on('subscribe', (topic) => {
    mqttClient.subscribe(topic, () => socket.emit('subscribed', topic));
  });
});

server.listen(PORT, () => {
  console.log(`🌍 HTTP + Socket.io running on port ${PORT}`);
});
