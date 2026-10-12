const cluster = require('./cluster');

function recordType(value) {
  if (value && typeof value.term === 'string' &&
      Array.isArray(value.titleScores) && Array.isArray(value.authorScores)) return 'index';
  if (Array.isArray(value) && value.length && value.every((book) => book &&
      ['title', 'author', 'language', 'url'].every((field) => typeof book[field] === 'string' && book[field]))) {
    return 'books';
  }
  return 'unfinished';
}

async function preprocess() {
  const {distribution, call} = cluster;
  const keys = await call(distribution.crawler.store.get, null);
  let type;
  if (keys.length) {
    // Check every record; a single sample can hide an interrupted/mixed dataset.
    const types = new Set();
    for (let offset = 0; offset < keys.length; offset += 50) {
      const values = await Promise.all(keys.slice(offset, offset + 50).map((key) =>
        call(distribution.crawler.store.get, key)));
      values.forEach((value) => types.add(recordType(value)));
    }
    if (types.size !== 1 || types.has('unfinished')) {
      throw new Error('Existing crawler data is incomplete or mixed. It has been preserved. ' +
        'For a fresh local crawl, set STORE_DIR to a new directory and use that same directory with npm start.');
    }
    type = [...types][0];
  }
  if (type === 'index') {
    console.log(`Existing index found (${keys.length} terms); skipping crawling and indexing.`);
  } else {
    if (type === 'books') {
      console.log(`Existing book metadata found (${keys.length} books); skipping crawling.`);
    } else {
      await require('./crawler').crawl();
    }
    await require('./index').index();
  }
  await require('./generateDict').generateDict();
  console.log('Preprocessing complete. Run npm start to open the website.');
}

if (require.main === module) {
  cluster.run(preprocess).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = {preprocess, recordType};
