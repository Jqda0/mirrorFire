const os = require('os');

function getLocalIP() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  const nets = os.networkInterfaces();
  let fallback = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const ip = net.address;
      const parts = ip.split('.').map(Number);
      // Skip Docker bridge ranges (172.16–31.x.x and common Docker NAT 10.0.0.x)
      const isDockerBridge =
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 10 && parts[1] === 0 && parts[2] === 0);
      if (!isDockerBridge) return ip;
      if (!fallback) fallback = ip;
    }
  }
  return fallback || '127.0.0.1';
}

module.exports = { getLocalIP };
