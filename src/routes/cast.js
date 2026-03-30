const { Router } = require('express');
const { getActiveStream, setActiveStream, clearActiveStream } = require('../state');
const { getLocalIP } = require('../network');
const { dlnaSetAndPlay, dlnaStop } = require('../dlna');

const PORT = 82;
const router = Router();

router.post('/start-cast', async (req, res) => {
  const { controlUrl, mimeType } = req.body;
  if (!controlUrl) return res.status(400).json({ error: 'controlUrl required' });

  const current = getActiveStream();
  if (current) {
    if (current.tvResponse) {
      try { current.tvResponse.end(); } catch {}
    }
    clearActiveStream();
  }

  const streamId = Date.now().toString(36);
  const serverIP = getLocalIP();
  const streamUrl = `http://${serverIP}:${PORT}/stream/${streamId}`;

  setActiveStream({
    id: streamId,
    controlUrl,
    mimeType: mimeType || 'video/webm',
    buffer: [],
    tvResponse: null,
    tvConnected: false,
  });

  console.log(`Stream created: ${streamUrl} (${getActiveStream().mimeType})`);

  try {
    const result = await dlnaSetAndPlay(controlUrl, streamUrl, getActiveStream().mimeType);
    res.json({
      success: true,
      streamId,
      streamUrl,
      dlnaStatus: { set: result.setResult.status, play: result.playResult.status },
    });
  } catch (err) {
    console.error('DLNA error:', err.message);
    res.status(500).json({ error: 'Failed to send to TV: ' + err.message });
  }
});

router.post('/stop-cast', async (_req, res) => {
  const current = getActiveStream();
  if (!current) return res.json({ success: true });

  try { await dlnaStop(current.controlUrl); } catch {}

  if (current.tvResponse) {
    try { current.tvResponse.end(); } catch {}
  }
  clearActiveStream();
  res.json({ success: true });
});

module.exports = router;
