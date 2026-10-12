const id = require('../util/id');

const nodeGroups = {}; // The map stores the nodes of each group
const groups = {}; // The service

groups.get = function(gid, callback) {
  if (typeof callback != 'function') {
    callback = () => {};
  }

  if (gid === 'all') {
    const combined = {};
    const trackedIPs = new Set();

    Object.keys(nodeGroups).forEach((group) => {
      const nodes = nodeGroups[group];
      Object.keys(nodes).forEach((id) => {
        const node = nodes[id];
        if (!trackedIPs.has(node.ip + ':' + node.port)) {
          combined[id] = node;
          trackedIPs.add(node.ip + ':' + node.port);
        }
      });
    });
    callback(null, combined);
  } else {
    const group = nodeGroups[gid];
    if (group) {
      callback(null, group);
    } else {
      callback(new Error(`Group ${gid} not found`), null);
    }
  }
};

groups.put = function(gidConfig, group, callback) {
  const config = typeof gidConfig === 'string' ? {gid: gidConfig} : gidConfig;
  const gid = config.gid;
  if (typeof callback != 'function') {
    callback = () => {};
  }
  if (!nodeGroups[gid]) {
    nodeGroups[gid] = {};
  }
  if (!global.distribution[gid]) {
    global.distribution[gid] = {};
    global.distribution[gid].comm = require('../all/comm.js')(config);
    global.distribution[gid].groups = require('../all/groups.js')(config);
    global.distribution[gid].status = require('../all/status.js')(config);
    global.distribution[gid].routes = require('../all/routes.js')(config);
    global.distribution[gid].gossip = require('../all/gossip.js')(config);
    global.distribution[gid].mem = require('../all/mem.js')(config);
    global.distribution[gid].store = require('../all/store.js')(config);
    global.distribution[gid].mr = require('../all/mr.js')(config);
  }
  nodeGroups[gid] = group;
  callback(null, group);
};

groups.del = function(gid, callback) {
  const group = nodeGroups[gid];
  if (group) {
    delete nodeGroups[gid];
    callback(null, group);
  } else {
    callback(new Error(`Group ${gid} not found`), null);
  }
};

groups.add = function(gid, node, callback) {
  if (typeof callback != 'function') {
    callback = () => {};
  }
  if (!nodeGroups[gid]) {
    nodeGroups[gid] = {};
  }
  const sid = id.getSID(node);
  nodeGroups[gid][sid] = node;
  callback(null, nodeGroups[gid]);
};

groups.rem = function(gid, sid, callback) {
  if (typeof callback != 'function') {
    callback = () => {};
  }
  if (!nodeGroups[gid] || !nodeGroups[gid][sid]) {
    callback(new Error(`Group ${gid} or Node ${sid} not found`), {});
  }
  delete nodeGroups[gid][sid];
  callback(null, nodeGroups[gid]);
};

module.exports = groups;
