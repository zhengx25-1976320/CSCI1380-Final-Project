let local = require('../local/local');
const distribution = global.distribution;

let groups = (config) => {
  let context = {};
  context.gid = config.gid || 'all';

  return {
    get: (gid, callback) => {
      distribution[context.gid].comm.send(
          [gid], {service: 'groups', method: 'get'}, callback);
    },
    put: (gidObj, group, callback) => {
      local.groups.put(gidObj, group, (e, v) => {
        distribution[context.gid].comm.send(
            [gidObj, group], {service: 'groups', method: 'put'}, callback);
      });
    },
    del: (gid, callback) => {
      distribution[context.gid].comm.send(
          [gid], {service: 'groups', method: 'del'}, callback);
    },
    add: (gid, node, callback) => {
      local.groups.add(gid, node, (e, v) => {
        distribution[context.gid].comm.send(
            [gid, node], {service: 'groups', method: 'add'}, callback);
      });
    },
    rem: (gid, sid, callback) => {
      local.groups.rem(gid, sid, (e, v) => {
        distribution[context.gid].comm.send(
            [gid, sid], {service: 'groups', method: 'rem'}, callback);
      });
    },
  };
};

module.exports = groups;
