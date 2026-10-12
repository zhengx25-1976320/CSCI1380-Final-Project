const cluster = require('./cluster');
const {distribution, call} = cluster;

let indexMap = (fileName, obj) => {
  if (!obj || !Array.isArray(obj) || obj.length === 0) {
    return [];
  }

  const {title, author, language, url} = obj[0];
  if (!title || !author || !language || !url) {
    return [];
  }

  const createNGrams = (words, n) => {
    const ngrams = [];
    for (let i = 0; i < words.length - n + 1; i++) {
      ngrams.push(words.slice(i, i + n).join(' '));
    }
    return ngrams;
  };

  const calculateTermFrequencies = (content) => {
    const tokenizer = new global.natural.WordTokenizer();
    const words = tokenizer.tokenize(content.toLowerCase());
    return words.concat(createNGrams(words, 2)).reduce((acc, term) => {
      acc[term] = (acc[term] || 0) + 1;
      return acc;
    }, {});
  };

  const titleData = calculateTermFrequencies(title);
  const authorData = calculateTermFrequencies(author);

  const output = [];
  [titleData, authorData].forEach((data, index) => {
    const tfLabel = index === 0 ? 'titleTF' : 'authorTF';
    Object.entries(data).forEach(([term, count]) => {
      let entry = output.find((o) => o.hasOwnProperty(term));
      if (!entry) {
        entry = {[term]: {url, title, author, language}};
        output.push(entry);
      }
      entry[term][tfLabel] = count / Object.keys(data).length;
    });
  });

  return output;
};

let indexReduce = (term, values) => {
  if (!values) {
    return {};
  }

  const N = 7000;
  const calculateIDF = (documentCount) =>
    documentCount > 0 ? 1 + Math.log(N / documentCount) : 0;

  const processEntries = (entries, tfLabel) => entries.filter((v) => v && v[tfLabel] !== undefined)
      .map((entry) => ({...entry, score: entry[tfLabel] * calculateIDF(entries.length)}));

  const titleScores = processEntries(values, 'titleTF');
  const authorScores = processEntries(values, 'authorTF');

  return {term, titleScores, authorScores};
};

async function index() {
  const keys = await call(distribution.crawler.store.get, null);
  if (!keys.length) throw new Error('No books found. Run the crawler first.');
  await call(distribution.crawler.mr.exec, {
    keys, map: indexMap, reduce: indexReduce, storeReducedValue: true,
  });
  console.log('Index complete');
}
if (require.main === module) {
  cluster.run(index).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = {index, indexMap, indexReduce};
