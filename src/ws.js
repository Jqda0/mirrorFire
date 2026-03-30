const { getActiveStream, senderSockets } = require('./state');

function setupWebSocket(wss) {
  wss.on('connection', (ws) => {
    let isSender = false;

    ws.on('message', (data) => {
      if (data instanceof Buffer || data instanceof ArrayBuffer) {
        const stream = getActiveStream();
        if (stream) {
          const buf = Buffer.from(data);
          stream.buffer.push(buf);

          // Keep last ~30 seconds (~60 chunks at 500 ms interval)
          if (stream.buffer.length > 120) {
            stream.buffer.splice(0, stream.buffer.length - 60);
          }

          if (stream.tvResponse) {
            try {
              stream.tvResponse.write(buf);
            } catch (err) {
              console.error('Error writing to TV:', err.message);
            }
          }
        }
        return;
      }

      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'register-sender') {
          isSender = true;
          senderSockets.add(ws);
          console.log('Phone (sender) connected via WebSocket');
        }
      } catch {}
    });

    ws.on('close', () => {
      if (isSender) {
        senderSockets.delete(ws);
        console.log('Phone (sender) disconnected');
      }
    });
  });
}

module.exports = { setupWebSocket };
