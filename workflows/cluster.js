// Configure identity before loading modules that capture nodeConfig.
global.nodeConfig = global.nodeConfig || {
  ip: process.env.NODE_HOST || '127.0.0.1',
  port: Number(process.env.RPC_PORT || 7070),
};
const distribution = require('../distribution');
const call = distribution.util.call;
const remote = process.env.WORKER_MODE === 'remote';
const nodes = process.env.WORKER_HOSTS ? process.env.WORKER_HOSTS.split(',').map((host) => {
  const address = new URL('http://' + host.trim());
  return {ip: address.hostname, port: Number(address.port || process.env.WORKER_PORT || 8080)};
}) : Array.from({length: 5}, (_, i) => ({ip: '127.0.0.1', port: Number(process.env.WORKER_BASE_PORT || 7110) + i}));
if (nodes.length !== 5 || nodes.some((node) => !node.ip)) throw new Error('Exactly five workers are required');
const group = Object.fromEntries(nodes.map((node) => [distribution.util.id.getSID(node), node]));
let rpcServer;
const owned = [];

async function register() {
  await call(require('../distribution/all/groups')({gid: 'crawler'}).put, {gid: 'crawler'}, group);
}

async function start() {
  rpcServer = await new Promise((resolve, reject) => {
    const server = distribution.node.start(resolve);
    server.on('error', reject);
  });
  if (!remote) {
    for (const node of nodes) {
      await call(distribution.local.status.spawn, {...node});
      owned.push(node);
    }
  }
  await register();
}

async function ready() {
  const checks = nodes.map(async (node) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await global.fetch(`http://${node.ip}:${node.port}/readyz`, {signal: controller.signal});
      if (!response.ok) throw new Error('Worker not ready: ' + node.ip);
    } finally {
      clearTimeout(timer);
    }
  });
  await Promise.all(checks);
  // Re-register membership after worker restarts (membership itself is in memory).
  await register();
}

async function stop() {
  await Promise.all(owned.map((node) => call(distribution.local.comm.send, [],
      {node, service: 'status', method: 'stop'}).catch(() => {})));
  if (rpcServer) await new Promise((resolve) => rpcServer.close(resolve));
}

async function run(task) {
  try {
    await start();
    await ready();
    await task();
  } finally {
    await stop();
  }
}
module.exports = {distribution, call, start, ready, stop, run, nodes};
