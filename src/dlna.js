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
  const match = xml.match(
    /urn:schemas-upnp-org:service:AVTransport:1[\s\S]*?<controlURL>(.*?)<\/controlURL>/
  );
  if (!match) return null;
  const controlPath = match[1];
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
      'SOAPAction': `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
    },
    body: soapBody,
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

  await new Promise((r) => setTimeout(r, 500));

  const playResult = await dlnaSoapAction(controlUrl, 'Play', `
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>`);

  console.log('Play:', playResult.status);
  return { setResult, playResult };
}

async function dlnaStop(controlUrl) {
  return dlnaSoapAction(controlUrl, 'Stop', '<InstanceID>0</InstanceID>');
}

module.exports = {
  fetchDeviceDescription,
  parseAVTransportControlUrl,
  parseFriendlyName,
  parseModelName,
  dlnaSetAndPlay,
  dlnaStop,
};
