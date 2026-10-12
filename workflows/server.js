const cluster = require('./cluster');
const {distribution, call} = cluster;
const express = require('express');
const path = require('path');
const checkSpelling = require('./spellcheck');
const app = express();
let started = false;
let webServer;
let stopping = false;
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/readyz', async (req, res) => {
  try {
    if (!started || stopping) throw new Error('Coordinator is starting or stopping');
    await cluster.ready();
    const keys = await call(distribution.crawler.store.get, null);
    if (!keys.length) throw new Error('Run preprocessing before searching');
    const sample = await call(distribution.crawler.store.get, keys[0]);
    if (!sample || !Array.isArray(sample.titleScores)) throw new Error('Index is not ready');
    res.send('ok');
  } catch (error) {
    res.status(503).send(error.message);
  }
});
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/search', async (req, res) => {
  if (!started || stopping) return res.status(503).json({error: 'Workers are not ready'});
  const type = req.query.type || 'title';
  if (!['title', 'author'].includes(type) || typeof req.query.term !== 'string') {
    return res.status(400).json({error: 'Provide a term and title or author type'});
  }
  const words = new global.natural.WordTokenizer().tokenize(req.query.term.toLowerCase());
  if (!words.length) return res.json({noMatch: true, results: []});
  const terms = [...new Set(words.slice(0, -1).map((word, i) => word + ' ' + words[i + 1]).concat(words))];
  try {
    await cluster.ready();
    const results = [];
    const seen = new Set();
    const suggestions = new Set();
    // Process phrase results first, regardless of network response order.
    for (const term of terms) {
      let entry;
      try {
        entry = await call(distribution.crawler.store.get, term);
      } catch (error) {
        if (error.code !== 'ENOENT' && !/ENOENT|Invalid Name/.test(error.message)) throw error;
        checkSpelling(term).forEach((word) => suggestions.add(word));
        continue;
      }
      const scores = entry[type + 'Scores'] || [];
      for (const book of [...scores].sort((a, b) => b.score - a.score).slice(0, 10)) {
        if (!seen.has(book.url)) {
          seen.add(book.url);
          const {title, author, language, url} = book;
          results.push({title, author, language, url});
        }
      }
    }
    res.json({noMatch: !results.length, results: results.length ? results : [...suggestions].slice(0, 3)});
  } catch (error) {
    console.error(error);
    res.status(503).json({error: 'Search backend is unavailable'});
  }
});

async function stop() {
  if (stopping) return;
  stopping = true;
  if (webServer) await new Promise((resolve) => webServer.close(resolve));
  await cluster.stop();
}
process.on('SIGINT', () => stop().catch(console.error));
process.on('SIGTERM', () => stop().catch(console.error));
webServer = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('Website listening on port ' + (process.env.PORT || 3000));
});
cluster.start().then(() => {
  started = true;
}).catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await stop();
});
