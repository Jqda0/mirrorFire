const dgram = require('dgram');

function ssdpDiscover(searchTarget, timeoutMs = 4000) {
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

module.exports = { ssdpDiscover };
