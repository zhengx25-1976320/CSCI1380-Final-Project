const id = require('../util/id');

module.exports = function(config) {
  const gid = config.gid || 'all';
  const hash = config.hash || id.naiveHash;
  const d = global.distribution;
  const call = d.util.call;

  async function target(key) {
    const group = await call(d.local.groups.get, gid);
    const nids = Object.values(group).map(id.getNID);
    if (!nids.length) throw new Error('Storage group has no workers');
    return group[hash(id.getID(key), nids).substring(0, 5)];
  }

  function operation(method, object, key, callback = () => {}) {
    (async () => {
      if (typeof key !== 'string') throw new Error('Storage key must be a string');
      const node = await target(key);
      const args = method === 'get' || method === 'del' ? [{gid, key}] : [object, {gid, key}];
      return call(d.local.comm.send, args, {node, service: 'store', method});
    })().then((value) => callback(null, value), callback);
  }

  return {
    get: (key, callback = () => {}) => {
      if (key != null) return operation('get', null, key, callback);
      d[gid].comm.send([{gid, key: null}], {service: 'store', method: 'get'}, (errors, values) => {
        callback(errors, Object.values(values || {}).flat());
      });
    },
    put: (object, key, callback) => operation('put', object, key == null ? id.getID(object) : key, callback),
    append: (object, key, callback) => operation('append', object, key == null ? id.getID(object) : key, callback),
    del: (key, callback) => operation('del', null, key, callback),
    reconf: (oldGroup, callback = () => {}) => {
      (async () => {
        const newGroup = await call(d.local.groups.get, gid);
        const newNids = Object.values(newGroup).map(id.getNID);
        if (!newNids.length) throw new Error('Cannot move data to an empty group');
        const listings = await Promise.all(Object.values(oldGroup).map(async (node) => ({
          node,
          keys: await call(d.local.comm.send, [{gid, key: null}], {node, service: 'store', method: 'get'}),
        })));
        for (const {node, keys} of listings) {
          for (const key of keys) {
            const destination = newGroup[hash(id.getID(key), [...newNids]).substring(0, 5)];
            if (id.getNID(node) === id.getNID(destination)) continue;
            const value = await call(d.local.comm.send, [{gid, key}], {node, service: 'store', method: 'get'});
            // Copy successfully before deleting the source; report completion once for the whole migration.
            await call(d.local.comm.send, [value, {gid, key}],
                {node: destination, service: 'store', method: 'put'});
            await call(d.local.comm.send, [{gid, key}], {node, service: 'store', method: 'del'});
          }
        }
        return true;
      })().then((value) => callback(null, value), callback);
    },
  };
};
