const http = require('http');
const serialization = require('../util/serialization');

module.exports = {
  send: (message, remote, callback = () => {}) => {
    let finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      if (error && !(error instanceof Error)) error = Object.assign(new Error(error.message), {code: error.code});
      callback(error, value);
    };
    try {
      const body = serialization.serialize(message);
      const req = http.request({
        hostname: remote.node.ip,
        port: remote.node.port,
        path: `/${remote.service}/${remote.method}`,
        method: 'PUT',
        headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('error', done);
        res.on('end', () => {
          try {
            const value = serialization.deserialize(data);
            if (!Array.isArray(value)) return done(value instanceof Error ? value : new Error('Invalid RPC response'));
            done(...value);
          } catch (error) {
            done(error);
          }
        });
      });
      req.setTimeout(Number(process.env.RPC_TIMEOUT_MS || 900000), () => req.destroy(new Error('RPC timed out')));
      req.on('error', done);
      req.end(body);
    } catch (error) {
      done(error);
    }
  },
};
