const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {spawn} = require('child_process');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gutenberg-test-'));
process.env.STORE_DIR = path.join(temporary, 'store');
process.env.DICTIONARY_PATH = path.join(temporary, 'dictionary.txt');
process.env.RPC_PORT = '17070';
process.env.WORKER_BASE_PORT = '17110';
const cluster = require('../workflows/cluster');
const {distribution: d, call} = cluster;

async function waitFor(url, status = 200) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === status) return response;
    } catch (error) {
      // Startup and worker restarts can briefly refuse connections.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ' + url);
}

test('five-worker RPC crawling/indexing, empty jobs, failures and persisted restarts', {timeout: 90000}, async () => {
  const fixture = http.createServer((req, res) => {
    if (req.url === '/') {
      return res.end('<a href="../">parent</a><a href="shelf/">shelf</a><a href="?sort=name">sort</a>');
    }
    if (req.url === '/shelf/') {
      return res.end('<a href="../">parent</a><a href="one.txt">one</a><a href="two.txt">two</a>');
    }
    if (req.url === '/shelf/one.txt') {
      return res.end('Title: Pride and Prejudice\nAuthor: Jane Austen\nLanguage: English\n');
    }
    if (req.url === '/shelf/two.txt') {
      return res.end('Title: Sense and Sensibility\nAuthor: Jane Austen\nLanguage: English\n');
    }
    res.statusCode = 404;
    res.end('missing');
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  process.env.CRAWL_URL = 'http://127.0.0.1:' + fixture.address().port + '/';
  let web;
  let output = '';
  try {
    await cluster.start();
    await cluster.ready();
    await assert.rejects(call(d.local.comm.send, [], {
      node: cluster.nodes[0], service: 'missing', method: 'get',
    }), /service not found/);
    const identity = (key, value) => ({[key]: value});
    const reduce = (key, values) => ({[key]: values.length});
    assert.deepEqual(await call(d.crawler.mr.exec, {keys: [], map: identity, reduce}), []);
    await call(d.crawler.store.put, 'retained', 'failure');
    await assert.rejects(call(d.crawler.mr.exec, {
      keys: ['failure'], map: async () => {
        throw new Error('mapper failed');
      }, reduce,
    }), /mapper failed/);
    assert.equal(await call(d.crawler.store.get, 'failure'), 'retained');
    await call(d.crawler.store.del, 'failure');
    await require('../workflows/crawler').crawl();
    assert.equal((await call(d.crawler.store.get, null)).length, 2);
    // The full pipeline should reuse crawled metadata rather than crawl again.
    await require('../workflows/preprocess').preprocess();
    const beforeReuse = await call(d.crawler.store.get, 'austen');
    // Simulate an old index's unencoded phrase filename on its owning worker.
    const phrase = 'pride and';
    const phraseNid = d.util.id.naiveHash(d.util.id.getID(phrase), cluster.nodes.map(d.util.id.getNID));
    const phraseDir = path.join(process.env.STORE_DIR, phraseNid.substring(0, 5), 'crawler');
    fs.renameSync(path.join(phraseDir, encodeURIComponent(phrase)), path.join(phraseDir, phrase));
    assert.equal((await call(d.crawler.store.get, phrase)).term, phrase);
    fs.unlinkSync(process.env.DICTIONARY_PATH);
    // Repeating preprocessing must preserve the existing index and recreate the dictionary.
    await require('../workflows/preprocess').preprocess();
    assert.deepEqual(await call(d.crawler.store.get, 'austen'), beforeReuse);
    assert.ok(fs.readFileSync(process.env.DICTIONARY_PATH, 'utf8').includes(phrase));
    await call(d.crawler.store.put, ['http://example.test/unfinished.txt'], 'unfinished');
    await assert.rejects(require('../workflows/preprocess').preprocess(), /incomplete or mixed/);
    assert.deepEqual(await call(d.crawler.store.get, 'austen'), beforeReuse);
    assert.deepEqual(await call(d.crawler.store.get, 'unfinished'), ['http://example.test/unfinished.txt']);
    await call(d.crawler.store.del, 'unfinished');
    const austen = await call(d.crawler.store.get, 'austen');
    assert.equal(austen.authorScores.length, 2);
    // All completed and failed jobs must remove their intermediate directories.
    for (const sid of fs.readdirSync(process.env.STORE_DIR)) {
      assert.ok(fs.readdirSync(path.join(process.env.STORE_DIR, sid)).every((name) => !name.startsWith('mr_')));
    }
    web = spawn(process.execPath, ['workflows/server.js'], {
      env: {...process.env, WORKER_MODE: 'remote',
        WORKER_HOSTS: cluster.nodes.map((node) => node.ip + ':' + node.port).join(','),
        RPC_PORT: '17071', PORT: '3001'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    web.stdout.on('data', (data) => output += data);
    web.stderr.on('data', (data) => output += data);
    await waitFor('http://127.0.0.1:3001/readyz');
    const search = async (term, type) => {
      const response = await fetch(`http://127.0.0.1:3001/search?term=${encodeURIComponent(term)}&type=${type}`);
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await search('pride', 'title')).results[0].title, 'Pride and Prejudice');
    assert.equal((await search('austen', 'author')).results.length, 2);
    assert.deepEqual((await search('!!!', 'title')).results, []);
    assert.ok((await search('prid', 'title')).results.includes('pride'));
    const nids = cluster.nodes.map(d.util.id.getNID);
    const ownerNid = d.util.id.naiveHash(d.util.id.getID('austen'), nids);
    const owner = cluster.nodes.find((node) => d.util.id.getNID(node) === ownerNid);
    await call(d.local.comm.send, [], {node: owner, service: 'status', method: 'stop'});
    await waitFor('http://127.0.0.1:3001/readyz', 503);
    await call(d.local.status.spawn, {...owner});
    await waitFor('http://127.0.0.1:3001/readyz');
    assert.equal((await search('austen', 'author')).results.length, 2);
    assert.equal((await call(d.crawler.store.get, 'austen')).authorScores.length, 2);
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    if (web && web.exitCode === null) {
      const exited = new Promise((resolve) => web.once('exit', resolve));
      web.kill('SIGTERM');
      await exited;
    }
    await cluster.stop();
    await new Promise((resolve) => fixture.close(resolve));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
