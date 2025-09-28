const http = require('http');
const express = require('express');
const aedes = require('aedes')();
const ws = require('websocket-stream');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 1️⃣ Attach Aedes WS first
ws.createServer({ server, path: '/mqtt' }, aedes.handle);

// 2️⃣ Attach Socket.io second
const io = new Server(server, { path: '/socket.io', cors: { origin: '*' } });

// 3️⃣ Socket.io events
io.on('connection', (socket) => {
  console.log('⚡ Socket.io connected:', socket.id);
});

// 4️⃣ Listen
const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
