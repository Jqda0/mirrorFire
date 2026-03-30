const express = require('express');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const os = require('os');
const path = require('path');

const app = express();
const mainHttp = require('http');
const server = mainHttp.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// --- Active stream state ---
let activeStream = null;

// --- SSDP Discovery for DLNA MediaRenderers ---

async function ssdpDiscover(searchTarget, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const results = [];
    const seen = new Set();

    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 3\r\n' +
      `ST: ${searchTarget}\r\n\r\n`
    );

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (data) => {
      const text = data.toString();
      const locMatch = text.match(/LOCATION:\s*(.*)/i);
      if (!locMatch) return;
      const location = locMatch[1].trim();
      if (seen.has(location)) return;
      seen.add(location);
      results.push({ location, raw: text });
    });

    socket.bind(() => {
      socket.addMembership('239.255.255.250');
      socket.send(msg, 0, msg.length, 1900, '239.255.255.250');
      setTimeout(() => socket.send(msg, 0, msg.length, 1900, '239.255.255.250'), 500);
    });

    setTimeout(() => {
      socket.close();
      resolve(results);
    }, timeoutMs);
  });
}

// --- Parse UPnP device description XML (simple regex parsing) ---

async function fetchDeviceDescription(locationUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(locationUrl, { signal: controller.signal });
    clearTimeout(timeout);
    return await res.text();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function parseAVTransportControlUrl(xml, locationUrl) {
  // Find AVTransport service block
  const avTransportMatch = xml.match(
    /urn:schemas-upnp-org:service:AVTransport:1[\s\S]*?<controlURL>(.*?)<\/controlURL>/
  );
  if (!avTransportMatch) return null;

  const controlPath = avTransportMatch[1];
  const base = new URL(locationUrl);
  if (controlPath.startsWith('http')) return controlPath;
  return `${base.protocol}//${base.host}${controlPath.startsWith('/') ? '' : '/'}${controlPath}`;
}

function parseFriendlyName(xml) {
  const match = xml.match(/<friendlyName>(.*?)<\/friendlyName>/);
  return match ? match[1] : null;
}

function parseModelName(xml) {
  const match = xml.match(/<modelName>(.*?)<\/modelName>/);
  return match ? match[1] : null;
}

// --- DLNA SOAP commands ---

async function dlnaSoapAction(controlUrl, action, body) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`
    },
    body: soapBody
  });

  return { status: res.status, body: await res.text() };
}

async function dlnaSetAndPlay(controlUrl, mediaUrl, mimeType) {
  const escapedUrl = mediaUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const metadata = `&lt;DIDL-Lite xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot; xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot;&gt;&lt;item id=&quot;0&quot; parentID=&quot;-1&quot; restricted=&quot;1&quot;&gt;&lt;dc:title&gt;Phone Screen&lt;/dc:title&gt;&lt;res protocolInfo=&quot;http-get:*:${mimeType}:*&quot;&gt;${escapedUrl}&lt;/res&gt;&lt;upnp:class&gt;object.item.videoItem&lt;/upnp:class&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;`;

  const setResult = await dlnaSoapAction(controlUrl, 'SetAVTransportURI', `
      <InstanceID>0</InstanceID>
      <CurrentURI>${escapedUrl}</CurrentURI>
      <CurrentURIMetaData>${metadata}</CurrentURIMetaData>`);

  console.log('SetAVTransportURI:', setResult.status);

  // Small delay before play
  await new Promise(r => setTimeout(r, 500));

  const playResult = await dlnaSoapAction(controlUrl, 'Play', `
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>`);

  console.log('Play:', playResult.status);
  return { setResult, playResult };
}

async function dlnaStop(controlUrl) {
  return dlnaSoapAction(controlUrl, 'Stop', '<InstanceID>0</InstanceID>');
}

// --- API Routes ---

app.get('/api/discover-tvs', async (req, res) => {
  console.log('Scanning for TVs...');
  const ssdpResults = await ssdpDiscover('urn:schemas-upnp-org:device:MediaRenderer:1');
  const tvs = [];

  for (const result of ssdpResults) {
    try {
      const xml = await fetchDeviceDescription(result.location);
      if (!xml) continue;

      const controlUrl = parseAVTransportControlUrl(xml, result.location);
      if (!controlUrl) continue;

      const name = parseFriendlyName(xml) || 'Unknown TV';
      const model = parseModelName(xml) || '';
      const ip = new URL(result.location).hostname;

      // Check if it's a Samsung TV (optional, for display)
      let isSamsung = false;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const samsungRes = await fetch(`http://${ip}:8001/api/v2/`, { signal: controller.signal });
        clearTimeout(timeout);
        if (samsungRes.ok) isSamsung = true;
      } catch {}

      tvs.push({ name, model, ip, controlUrl, isSamsung });
      console.log(`Found: ${name} (${ip}) - Control: ${controlUrl}`);
    } catch (err) {
      console.log('Error parsing device:', err.message);
    }
  }

  res.json({ tvs });
});

app.post('/api/start-cast', async (req, res) => {
  const { controlUrl, mimeType } = req.body;
  if (!controlUrl) return res.status(400).json({ error: 'controlUrl required' });

  // Clean up any previous stream
  if (activeStream) {
    if (activeStream.tvResponse) {
      try { activeStream.tvResponse.end(); } catch {}
    }
    activeStream = null;
  }

  const streamId = Date.now().toString(36);
  const serverIP = getLocalIP();
  const streamUrl = `http://${serverIP}:${PORT}/stream/${streamId}`;

  activeStream = {
    id: streamId,
    controlUrl,
    mimeType: mimeType || 'video/webm',
    buffer: [],
    tvResponse: null,
    tvConnected: false
  };

  console.log(`Stream created: ${streamUrl} (${activeStream.mimeType})`);

  try {
    const result = await dlnaSetAndPlay(controlUrl, streamUrl, activeStream.mimeType);
    res.json({
      success: true,
      streamId,
      streamUrl,
      dlnaStatus: { set: result.setResult.status, play: result.playResult.status }
    });
  } catch (err) {
    console.error('DLNA error:', err.message);
    res.status(500).json({ error: 'Failed to send to TV: ' + err.message });
  }
});

app.post('/api/stop-cast', async (req, res) => {
  if (!activeStream) return res.json({ success: true });

  try {
    await dlnaStop(activeStream.controlUrl);
  } catch {}

  if (activeStream.tvResponse) {
    try { activeStream.tvResponse.end(); } catch {}
  }
  activeStream = null;
  res.json({ success: true });
});

// --- Stream endpoint (separate HTTP server for TV, since TV won't accept self-signed HTTPS) ---

app.get('/stream/:id', (req, res) => {
  if (!activeStream || activeStream.id !== req.params.id) {
    return res.status(404).send('Stream not found');
  }

  console.log('TV connected to stream!');
  activeStream.tvConnected = true;

  res.writeHead(200, {
    'Content-Type': activeStream.mimeType,
    'Transfer-Encoding': 'chunked',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*'
  });

  // Send buffered chunks
  for (const chunk of activeStream.buffer) {
    res.write(chunk);
  }

  activeStream.tvResponse = res;

  // Notify the phone that TV is receiving
  broadcastToSenders({ type: 'tv-receiving' });

  req.on('close', () => {
    console.log('TV disconnected from stream');
    if (activeStream) {
      activeStream.tvResponse = null;
      activeStream.tvConnected = false;
    }
    broadcastToSenders({ type: 'tv-disconnected' });
  });
});

// --- WebSocket: receive media chunks from phone ---

const senderSockets = new Set();

function broadcastToSenders(msg) {
  const data = JSON.stringify(msg);
  for (const ws of senderSockets) {
    if (ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  let isSender = false;

  ws.on('message', (data) => {
    // Binary data = media chunk from phone
    if (data instanceof Buffer || data instanceof ArrayBuffer) {
      if (activeStream) {
        const buf = Buffer.from(data);
        activeStream.buffer.push(buf);

        // Keep buffer manageable (last ~30 seconds worth, ~60 chunks at 500ms interval)
        if (activeStream.buffer.length > 120) {
          activeStream.buffer.splice(0, activeStream.buffer.length - 60);
        }

        if (activeStream.tvResponse) {
          try {
            activeStream.tvResponse.write(buf);
          } catch (err) {
            console.error('Error writing to TV:', err.message);
          }
        }
      }
      return;
    }

    // JSON messages
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

// --- Start server ---

const PORT = 82;

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n=== MirrorFire ===\n');
  console.log(`  Open on your phone: http://${ip}:${PORT}\n`);
});
