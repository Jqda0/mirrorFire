const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const { getLocalIP } = require('./src/network');
const { setupWebSocket } = require('./src/ws');
const discoverRouter = require('./src/routes/discover');
const castRouter = require('./src/routes/cast');
const streamRouter = require('./src/routes/stream');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', discoverRouter);
app.use('/api', castRouter);
app.use(streamRouter);

setupWebSocket(wss);

const PORT = process.env.PORT || 82;

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n=== MirrorFire ===\n');
  console.log(`  Open on your phone: http://${ip}:${PORT}\n`);
});
