let selectedTV = null;
let ws = null;
let mediaRecorder = null;
let localStream = null;

// --- Step 1: Scan ---

async function scanForTVs() {
  const btn = document.getElementById('scan-btn');
  btn.innerHTML = '<span class="spinner"></span>Scanning...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/discover-tvs');
    const data = await res.json();
    const div = document.getElementById('tv-results');

    if (data.tvs.length === 0) {
      div.innerHTML = `
        <p style="color:#f44336;margin:0.6rem 0 0.3rem">No TVs found.</p>
        <p style="color:#888;font-size:0.8rem">Make sure your TV is on and on the same Wi-Fi.</p>`;
      btn.textContent = 'Try Again';
      btn.disabled = false;
      return;
    }

    let html = '<ul class="tv-list">';
    data.tvs.forEach((tv, i) => {
      html += `<li class="tv-item" onclick="pickTV(this, ${i})" data-idx="${i}">
        <div class="tv-name">${tv.name}</div>
        <div class="tv-detail">${tv.ip}${tv.model ? ' · ' + tv.model : ''}${tv.isSamsung ? ' · Samsung' : ''}</div>
      </li>`;
    });
    html += '</ul>';
    div.innerHTML = html;

    window._tvs = data.tvs;
    btn.classList.add('hidden');
  } catch (err) {
    document.getElementById('tv-results').innerHTML =
      `<p style="color:#f44336;margin-top:0.5rem">${err.message}</p>`;
  }

  btn.disabled = false;
  btn.textContent = 'Scan for TVs';
}

function pickTV(el, idx) {
  document.querySelectorAll('.tv-item').forEach((e) => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedTV = window._tvs[idx];

  document.getElementById('b1').className = 'badge done';
  document.getElementById('b1').textContent = '\u2713';
  document.getElementById('b2').className = 'badge active';
  document.getElementById('card2').style.opacity = '1';
  document.getElementById('cast-btn').disabled = false;
}

// --- Step 2: Cast ---

async function startCast() {
  const btn = document.getElementById('cast-btn');
  btn.innerHTML = '<span class="spinner"></span>Starting...';
  btn.disabled = true;
  setCastStatus('');

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error(
        'Screen capture not supported on this browser. ' +
        'Make sure you are using Chrome on your phone and accessing via HTTPS.'
      );
    }

    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

    const preview = document.getElementById('preview');
    preview.srcObject = localStream;
    preview.style.display = 'block';
    preview.play();

    localStream.getVideoTracks()[0].onended = () => stopCast();

    const mimeType = pickMimeType();
    console.log('Using codec:', mimeType);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tv-receiving') {
          setCastStatus('TV is receiving your stream!', 'ok');
        } else if (msg.type === 'tv-disconnected') {
          setCastStatus('TV stopped receiving', 'err');
        }
      } catch {}
    };

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register-sender' }));
        resolve();
      };
      ws.onerror = reject;
      setTimeout(reject, 5000);
    });

    mediaRecorder = new MediaRecorder(localStream, {
      mimeType,
      videoBitsPerSecond: 2500000,
    });

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && ws && ws.readyState === 1) {
        const buffer = await e.data.arrayBuffer();
        ws.send(buffer);
      }
    };

    mediaRecorder.start(500);

    setCastStatus('Sending to TV...', '');

    const castRes = await fetch('/api/start-cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controlUrl: selectedTV.controlUrl,
        mimeType: mimeType.split(';')[0],
      }),
    });
    const castData = await castRes.json();

    if (castData.success) {
      setCastStatus('Casting to TV...', 'ok');
      document.getElementById('b2').className = 'badge done';
      document.getElementById('b2').textContent = '\u2713';
      btn.classList.add('hidden');
      document.getElementById('stop-btn').classList.remove('hidden');
    } else {
      setCastStatus('Error: ' + (castData.error || 'Failed'), 'err');
      stopCast();
    }
  } catch (err) {
    console.error(err);
    setCastStatus('Error: ' + err.message, 'err');
    btn.disabled = false;
    btn.textContent = 'Start Casting';
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
  }
}

async function stopCast() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  try { await fetch('/api/stop-cast', { method: 'POST' }); } catch {}

  document.getElementById('preview').style.display = 'none';
  document.getElementById('stop-btn').classList.add('hidden');
  const btn = document.getElementById('cast-btn');
  btn.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Start Casting';
  document.getElementById('b2').className = 'badge active';
  document.getElementById('b2').textContent = '2';
  setCastStatus('Stopped.', '');
}

function setCastStatus(text, cls) {
  const el = document.getElementById('cast-status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function pickMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
}
