// Shared mutable state. All modules import from here — nothing here imports from src/.

let activeStream = null;
const senderSockets = new Set();

function broadcastToSenders(msg) {
  const data = JSON.stringify(msg);
  for (const ws of senderSockets) {
    if (ws.readyState === 1) ws.send(data);
  }
}

module.exports = {
  getActiveStream: () => activeStream,
  setActiveStream: (stream) => { activeStream = stream; },
  clearActiveStream: () => { activeStream = null; },
  senderSockets,
  broadcastToSenders,
};
