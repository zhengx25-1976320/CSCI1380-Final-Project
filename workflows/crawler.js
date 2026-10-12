const cluster = require('./cluster');
const {distribution, call} = cluster;

let mapCrawlParent = async (key, value) => {
  const response = await global.fetch(value);
  const content = await response.text();
  // console.log('content: ', content);

  const dom = new global.JSDOM(content);
  const baseURL = value;
  const anchorElements = Array.from(dom.window.document.querySelectorAll('a'));
  let out = [];
  anchorElements.map((a) => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('?') || href === '../' || href === './') return;
    let o = {};
    let hrefKey = href.toString().replace(/[^a-zA-Z0-9_-]/g, '');
    // check it has data or CDOA, CMOA, CNOD, CSOA,
    const isDataOrOneOf = hrefKey.includes('data') || ['CDOA', 'CMOA', 'CNOD', 'CSOA'].includes(hrefKey);
    if (isDataOrOneOf == false) {
      o[hrefKey] = new URL(href, baseURL).toString();
      out.push(o);
    }
  });

  return out;
};

let reduceCrawlParent = (key, values) => {
  // check txt
  if (values[0].includes('txt') == false) {
    return key;
  } else {
    return null;
  }
};

let mapCrawlChild = async (key, values) => {
  let out = [];
  // console.log('Extract URLs Key and Values: ', key, values);
  async function fetchWithTimeout(resource, options = {}) {
    const {timeout = 8000} = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response;
  }
  for (const value of values) {
    const baseURL = value;
    try {
      const response = await fetchWithTimeout(value, {
        timeout: 600000,
      });
      const content = await response.text();
      const dom = new global.JSDOM(content);
      const anchorElements = Array.from(dom.window.document.querySelectorAll('a'));
      // console.log('anchorElements: ', anchorElements);

      anchorElements.map((a) => {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('?') || href === '../' || href === './') return;
        let o = {};
        let hrefKey = href.toString().replace(/[^a-zA-Z0-9_-]/g, '');
        // check it has data or CDOA, CMOA, CNOD, CSOA,
        const isDataOrOneOf = hrefKey.includes('data') || ['CDOA', 'CMOA', 'CNOD', 'CSOA'].includes(hrefKey);
        if (isDataOrOneOf == false) {
          const newURL = new URL(href, baseURL).toString();
          // console.log('NewUrl: ', newURL);
          o[hrefKey] = newURL;
          out.push(o);
        }
      });
    } catch (e) {
      console.log('Extract URLs Fetch Error: ', e);
      throw e;
    };
  }
  return out;
};

let mapCrawlText = async (key, values) => {
  let out = {};
  let o = {};
  // console.log('Crawl Text Key and Values: ', key, values);
  async function fetchWithTimeout(resource, options = {}) {
    const {timeout = 8000} = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response;
  }
  try {
    const response = await fetchWithTimeout(values[0], {
      timeout: 600000,
    });
    // const response = await global.fetch(baseURL);
    const content = await response.text();
    // find the language
    let languageIndex = content.indexOf('Language: ');
    if (languageIndex !== -1) {
      let newlineIndex = content.indexOf('\n', languageIndex);
      if (newlineIndex !== -1) {
        let languageField = content.substring(languageIndex + 'Language: '.length, newlineIndex).trim();
        o['language'] = languageField;
      // console.log('Language: ', languageField);
      }
    } else {
      o['language'] = 'Unknown';
    }
    // find the title
    let titleIndex = content.indexOf('Title: ');
    if (titleIndex !== -1) {
      let newlineIndex = content.indexOf('\n', titleIndex);
      if (newlineIndex !== -1) {
        let titleField = content.substring(titleIndex + 'Title: '.length, newlineIndex).trim();
        o['title'] = titleField;
      // console.log('Title: ', titleField);
      }
    } else {
      o['title'] = 'Unknown';
    }
    // find the author
    let authorIndex = content.indexOf('Author: ');
    if (authorIndex!== -1) {
      let newlineIndex = content.indexOf('\n', authorIndex);
      if (newlineIndex!== -1) {
        let authorField = content.substring(authorIndex + 'Author: '.length, newlineIndex).trim();
        o['author'] = authorField;
      // console.log('Author: ', authorField);
      }
    } else {
      o['author'] = 'Anonymous';
    }

    // let sanitizeContent = content.toString().replace(/[^a-zA-Z0-9\s?!,;.]/g, ' ');
    // clean the \r and \n
    // sanitizeContent = sanitizeContent.replace(/\r?\n|\r/g, '');
    o['url'] = values[0];
    // o['content'] = sanitizeContent;
    out[key] = o;
  } catch (error) {
    console.error('Crawl Text Fetch error:', error);
    // fetch error and we could store the urls and crawl again
    throw error;
  }
  return out;
};

let reduceCrawlText = (key, values) => {
  return values;
};

async function crawl() {
  const existing = await call(distribution.crawler.store.get, null);
  if (existing.length) throw new Error('Crawler storage is not empty; use fresh worker volumes for a new corpus.');
  const seed = process.env.CRAWL_URL || 'https://atlas.cs.brown.edu/data/gutenberg/1/1/1/';
  await call(distribution.crawler.store.put, seed, '000');
  let keys = ['000'];
  let first = true;
  for (let depth = 0; keys.length; depth++) {
    if (depth >= 20) throw new Error('Crawler exceeded 20 directory levels');
    keys = await call(distribution.crawler.mr.exec, {
      keys, map: first ? mapCrawlParent : mapCrawlChild,
      reduce: reduceCrawlParent, storeReducedValue: false,
    });
    first = false;
  }
  keys = await call(distribution.crawler.store.get, null);
  await call(distribution.crawler.mr.exec, {
    keys, map: mapCrawlText, reduce: reduceCrawlText, storeReducedValue: false,
  });
  console.log('Crawling complete');
}
if (require.main === module) {
  cluster.run(crawl).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = {crawl};
