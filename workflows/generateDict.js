const fs = require('fs');
const path = require('path');
const cluster = require('./cluster');
async function generateDict() {
  const keys = await cluster.call(cluster.distribution.crawler.store.get, null);
  const file = process.env.DICTIONARY_PATH || path.join(__dirname, 'dictionary.txt');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, [...new Set(keys)].sort().join('\n') + '\n');
  console.log('Dictionary generated');
}
if (require.main === module) {
  cluster.run(generateDict).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = {generateDict};
