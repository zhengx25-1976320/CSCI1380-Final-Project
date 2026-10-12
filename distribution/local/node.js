const http = require('http');
const fs = require('fs');
const path = require('path');
const local = require('./local');
const serialization = require('../util/serialization');

const start = function(onStart = () => {}) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && ['/healthz', '/readyz'].includes(pathname)) {
      try {
        if (pathname === '/readyz') {
          const root = path.resolve(process.env.STORE_DIR || path.join(__dirname, '../../store'));
          fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
        }
        res.end('ok');
      } catch (error) {
        res.statusCode = 503;
        res.end(error.message);
      }
      return;
    }
    const reply = (error, value) => {
      if (!res.writableEnded) res.end(serialization.serialize([error, value]));
    };
    if (req.method !== 'PUT') return reply(new Error('Method not allowed'));
    const [, name, method] = pathname.split('/');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const args = serialization.deserialize(Buffer.concat(chunks).toString());
        if (!Array.isArray(args)) throw new Error('RPC arguments must be an array');
        local.routes.get(name, (error, service) => {
          if (error) return reply(error);
          if (typeof service[method] !== 'function') return reply(new Error('Unknown RPC method'));
          try {
            const result = service[method](...args, reply);
            if (result && typeof result.catch === 'function') result.catch(reply);
          } catch (error) {
            reply(error);
          }
        });
      } catch (error) {
        reply(error);
      }
    });
    req.on('error', reply);
  });
  server.listen(global.nodeConfig.port, process.env.BIND_HOST || global.nodeConfig.ip, () => onStart(server));
  return server;
};
module.exports = {start};
