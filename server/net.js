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

function probePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port);
  });
}

async function findOpenPort(start, end) {
  for (let p = start; p <= end; p++) {
    if (await probePort(p)) return p;
  }
  throw new Error(`No free port in range ${start}-${end}`);
}

module.exports = { findOpenPort, pickLanIp };
