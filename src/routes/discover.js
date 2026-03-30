const { Router } = require('express');
const { ssdpDiscover } = require('../ssdp');
const {
  fetchDeviceDescription,
  parseAVTransportControlUrl,
  parseFriendlyName,
  parseModelName,
} = require('../dlna');

const router = Router();

router.get('/discover-tvs', async (_req, res) => {
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

module.exports = router;
