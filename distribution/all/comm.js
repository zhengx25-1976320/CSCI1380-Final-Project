const localComm = require('../local/comm');
const groups = require('../local/groups');
let comm = (config) => {
  let context = {};
  context.gid = config.gid || 'all'; // contains a property named gid
  return {
    send: (message, remote, callback) => {
      // console.log('all.comm.send get called!', remote);
      callback = callback || function() {};
      groups.get(context.gid, (error, nodeGroup) => {
        if (error != null) {
          callback(new Error('Get Group Error'), null);
        } else {
          let counter = Object.keys(nodeGroup).length;
          //   console.log(counter);
          if (counter === 0) return callback({}, {});
          let values = {};
          let errors = {};
          //   console.log('Start local.comm.send to ', counter, ' nodes!');
          for (let sid of Object.keys(nodeGroup)) {
            let remoteInfo = {
              node: nodeGroup[sid],
              service: remote.service,
              method: remote.method,
            };
            // console.log('local send: ', remoteInfo);
            localComm.send(message, remoteInfo, (e, v) => {
            //   console.log('Successfully send to one node!');
              if (e != null) {
                // console.log(e);
                errors[sid] = e;
              } else {
                values[sid] = v;
              }
              counter--;
              if (counter == 0) {
                callback(errors, values);
              }
            });
          }
        }
      });
    },
  };
};

module.exports = comm;

