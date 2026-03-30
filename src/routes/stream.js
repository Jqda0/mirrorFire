const { Router } = require('express');
const { getActiveStream } = require('../state');
const { broadcastToSenders } = require('../state');

const router = Router();

router.get('/stream/:id', (req, res) => {
  const stream = getActiveStream();
  if (!stream || stream.id !== req.params.id) {
    return res.status(404).send('Stream not found');
  }

  console.log('TV connected to stream!');
  stream.tvConnected = true;

  res.writeHead(200, {
    'Content-Type': stream.mimeType,
    'Transfer-Encoding': 'chunked',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*',
  });

  for (const chunk of stream.buffer) {
    res.write(chunk);
  }

  stream.tvResponse = res;
  broadcastToSenders({ type: 'tv-receiving' });

  req.on('close', () => {
    console.log('TV disconnected from stream');
    const active = getActiveStream();
    if (active) {
      active.tvResponse = null;
      active.tvConnected = false;
    }
    broadcastToSenders({ type: 'tv-disconnected' });
  });
});

module.exports = router;
