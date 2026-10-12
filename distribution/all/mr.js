const crypto = require('crypto');
const id = require('../util/id');

module.exports = function(config) {
  const gid = config.gid || 'all';
  const hash = config.hash || id.naiveHash;
  // One job per group per coordinator. Different groups use isolated storage.
  let running = false;
  return {
    exec: (configuration, callback) => {
      if (running) return callback(new Error('A MapReduce job is already running in this group'));
      const {keys, map, reduce, compact, storeReducedValue} = configuration;
      if (!Array.isArray(keys) || typeof map !== 'function' || typeof reduce !== 'function') {
        return callback(new Error('MapReduce requires keys, map and reduce'));
      }
      running = true;
      const job = 'mr_' + crypto.randomBytes(12).toString('hex');
      const mappedGid = job + '_map';
      const shuffledGid = job + '_shuffle';
      // These functions travel over RPC: dependencies must come from the worker's globals.
      const service = {
        mapper: async (keys, map, compact, gid, mappedGid, callback) => {
          const d = global.distribution;
          const call = d.util.call;
          try {
            const localKeys = await call(d.local.store.get, {gid, key: null});
            for (const key of localKeys.filter((key) => keys.includes(key))) {
              const input = await call(d.local.store.get, {gid, key});
              let output = await map(key, input);
              if (compact) output = await compact(output);
              await call(d.local.store.put, output || [], {gid: mappedGid, key});
            }
            callback(null, true);
          } catch (error) {
            callback(error);
          }
        },
        shuffle: async (mappedGid, shuffledGid, group, hash, callback) => {
          const d = global.distribution;
          const call = d.util.call;
          try {
            const nids = Object.values(group).map((node) => d.util.id.getNID(node));
            const keys = await call(d.local.store.get, {gid: mappedGid, key: null});
            const buckets = Object.create(null);
            const emitted = new Set();
            for (const key of keys) {
              const output = await call(d.local.store.get, {gid: mappedGid, key});
              const records = Array.isArray(output) ? output : [output];
              for (const record of records) {
                for (const term of Object.keys(record || {})) {
                  const sid = hash(d.util.id.getID(term), [...nids]).substring(0, 5);
                  buckets[sid] = buckets[sid] || Object.create(null);
                  buckets[sid][term] = buckets[sid][term] || [];
                  buckets[sid][term].push(record[term]);
                  emitted.add(term);
                }
              }
            }
            // Await every destination, including failures, before reporting the phase complete.
            const sends = Object.entries(buckets).map(async ([sid, values]) => {
              try {
                await call(d.local.comm.send, [values, {gid: shuffledGid}],
                    {node: group[sid], service: 'store', method: 'appendAll'});
                return null;
              } catch (error) {
                return error;
              }
            });
            const failures = (await Promise.all(sends)).filter(Boolean);
            if (failures.length) throw failures[0];
            callback(null, [...emitted]);
          } catch (error) {
            callback(error);
          }
        },
        reducer: async (shuffledGid, gid, reduce, storeReducedValue, callback) => {
          const d = global.distribution;
          const call = d.util.call;
          try {
            const keys = await call(d.local.store.get, {gid: shuffledGid, key: null});
            const results = [];
            for (const key of keys) {
              const values = await call(d.local.store.get, {gid: shuffledGid, key});
              const output = await reduce(key, values);
              // Crawling needs grouped values retained for the next directory traversal.
              await call(d.local.store.put, storeReducedValue ? output : values, {gid, key});
              if (output !== null && output !== undefined) results.push(output);
            }
            callback(null, results);
          } catch (error) {
            callback(error);
          }
        },
        consume: async (keys, gid, callback) => {
          const d = global.distribution;
          try {
            const existing = await d.util.call(d.local.store.get, {gid, key: null});
            for (const key of existing.filter((key) => keys.includes(key))) {
              await d.util.call(d.local.store.del, {gid, key});
            }
            callback(null, true);
          } catch (error) {
            callback(error);
          }
        },
        cleanup: (mappedGid, shuffledGid, callback) => {
          try {
            global.distribution.local.store.clearGroup(mappedGid, (error) => {
              if (error) return callback(error);
              global.distribution.local.store.clearGroup(shuffledGid, callback);
            });
          } catch (error) {
            callback(error);
          }
        },
      };
      const d = global.distribution;
      const call = d.util.call;
      const phase = (method, args) => call(d[gid].comm.send, args, {service: job, method});
      (async () => {
        let result;
        let failure;
        try {
          const group = await call(d.local.groups.get, gid);
          if (!Object.keys(group).length) throw new Error('MapReduce group has no workers');
          await call(d[gid].routes.put, service, job);
          await phase('mapper', [keys, map, compact, gid, mappedGid]);
          await phase('shuffle', [mappedGid, shuffledGid, group, hash]);
          // Preserve inputs through mapping/shuffling; consume only before publishing outputs.
          await phase('consume', [keys, gid]);
          const results = await phase('reducer', [shuffledGid, gid, reduce, storeReducedValue]);
          result = Object.values(results).flat();
        } catch (error) {
          failure = error;
        } finally {
          try {
            await phase('cleanup', [mappedGid, shuffledGid]);
          } catch (error) {
            failure = failure || error;
          }
          try {
            await call(d[gid].routes.del, job);
          } catch (error) {
            failure = failure || error;
          }
          running = false;
        }
        callback(failure || null, result);
      })();
    },
  };
};
