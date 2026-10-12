const serialization = require('./serialization');
const id = require('./id');
const wire = require('./wire');

module.exports = {
  call: require('./call'),
  serialize: serialization.serialize,
  deserialize: serialization.deserialize,
  id: id,
  wire: wire,
};
