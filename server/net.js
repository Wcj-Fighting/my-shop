const net = require('node:net');

const VIRTUAL_NAME_PATTERNS = [
  /vEthernet/i,
  /VMware/i,
  /VirtualBox/i,
  /Tailscale/i,
  /Hyper-?V/i,
  /Loopback/i,
];

function isVirtual(name) {
  return VIRTUAL_NAME_PATTERNS.some((re) => re.test(name));
}

function ipPriority(addr) {
  if (addr.startsWith('192.168.')) return 0;
  if (addr.startsWith('10.')) return 1;
  if (addr.startsWith('172.')) return 2;
  return 3;
}

function pickLanIp(interfaces) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (isVirtual(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      candidates.push({ name, address: a.address });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => ipPriority(a.address) - ipPriority(b.address));
  return candidates[0].address;
}

function probeOn(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

async function probePort(port) {
  // Probe both stacks: a port is "free" only when both IPv4 and IPv6
  // can bind. Otherwise we may pick a port already held by an IPv4-only
  // listener (e.g. python http.server) and let browser-sync silently
  // fall back to a different port without updating our banner.
  const v4 = await probeOn(port, '0.0.0.0');
  if (!v4) return false;
  const v6 = await probeOn(port, '::');
  return v6;
}

async function findOpenPort(start, end) {
  for (let p = start; p <= end; p++) {
    if (await probePort(p)) return p;
  }
  throw new Error(`No free port in range ${start}-${end}`);
}

module.exports = { findOpenPort, pickLanIp };
