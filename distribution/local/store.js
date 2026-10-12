const fs = require('fs');
const path = require('path');
const id = require('../util/id');
const serialization = require('../util/serialization');

const root = path.resolve(process.env.STORE_DIR || path.join(__dirname, '../../store'));
const nodePath = path.join(root, id.getSID(global.nodeConfig));
fs.mkdirSync(nodePath, {recursive: true});

function configOf(config, object) {
  const c = typeof config === 'string' ? {key: config} : {...(config || {})};
  c.gid = c.gid || 'local';
  if (c.key == null && object !== undefined) c.key = id.getID(object);
  if (typeof c.gid !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(c.gid)) throw new Error('Invalid group');
  if (c.key != null && typeof c.key !== 'string') throw new Error('Invalid key');
  return c;
}

function location(c) {
  const folder = path.join(nodePath, c.gid);
  fs.mkdirSync(folder, {recursive: true});
  // Encode path separators in keys; terms themselves remain visible to the API.
  return c.key == null ? folder : path.join(folder, encodeURIComponent(c.key));
}

// Older checkouts stored literal spaces and punctuation in filenames.
// Reuse those files without renaming or deleting an existing corpus.
function existingLocation(c) {
  const encoded = location(c);
  if (c.key == null || fs.existsSync(encoded)) return encoded;
  if (c.key === '.' || c.key === '..' || /[\\/\0]/.test(c.key)) return encoded;
  const legacy = path.join(nodePath, c.gid, c.key);
  return fs.existsSync(legacy) ? legacy : encoded;
}

function decodeKey(key) {
  try {
    return decodeURIComponent(key);
  } catch (error) {
    return key;
  }
}

function atomicWrite(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, serialization.serialize(value));
  fs.renameSync(temporary, file);
}

const store = {
  put: (object, config, callback = () => {}) => {
    try {
      atomicWrite(existingLocation(configOf(config, object)), object);
      callback(null, object);
    } catch (error) {
      callback(Object.assign(new Error(error.message), {code: error.code}));
    }
  },
  get: (config, callback = () => {}) => {
    try {
      const c = configOf(config);
      const file = existingLocation(c);
      const value = c.key == null ?
        fs.readdirSync(file).filter((key) => !key.endsWith('.tmp')).map(decodeKey) :
        serialization.deserialize(fs.readFileSync(file, 'utf8'));
      callback(null, value);
    } catch (error) {
      callback(Object.assign(new Error(error.message), {code: error.code}));
    }
  },
  del: (config, callback = () => {}) => {
    try {
      const file = existingLocation(configOf(config));
      const value = serialization.deserialize(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
      callback(null, value);
    } catch (error) {
      callback(Object.assign(new Error(error.message), {code: error.code}));
    }
  },
  append: (object, config, callback = () => {}) => {
    try {
      const file = existingLocation(configOf(config, object));
      const old = fs.existsSync(file) ? serialization.deserialize(fs.readFileSync(file, 'utf8')) : [];
      const values = (Array.isArray(old) ? old : [old]).concat(Array.isArray(object) ? object : [object]);
      // Synchronous read/modify/rename keeps RPC appends serialized within this worker.
      atomicWrite(file, values);
      callback(null, object);
    } catch (error) {
      callback(Object.assign(new Error(error.message), {code: error.code}));
    }
  },
  appendAll: (objects, config, callback = () => {}) => {
    const values = [];
    for (const key of Object.keys(objects)) {
      let failure;
      store.append(objects[key], {...config, key}, (error, value) => {
        failure = error;
        values.push(value);
      });
      if (failure) return callback(failure);
    }
    callback(null, values);
  },
  clearGroup: (gid, callback = () => {}) => {
    try {
      const c = configOf({gid});
      if (!/^mr_[a-f0-9]+_(map|shuffle)$/.test(c.gid)) throw new Error('Only job storage can be cleared');
      fs.rmSync(path.join(nodePath, c.gid), {recursive: true, force: true});
      callback(null, true);
    } catch (error) {
      callback(Object.assign(new Error(error.message), {code: error.code}));
    }
  },
};
module.exports = store;
