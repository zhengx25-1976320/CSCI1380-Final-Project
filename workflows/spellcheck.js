const natural = require('natural');
const fs = require('fs');
const path = require('path');
const file = process.env.DICTIONARY_PATH || path.join(__dirname, 'dictionary.txt');
let modified;
let checker;
module.exports = function(word) {
  if (!fs.existsSync(file)) return [];
  const mtime = fs.statSync(file).mtimeMs;
  if (!checker || modified !== mtime) {
    checker = new natural.Spellcheck(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean));
    modified = mtime;
  }
  return checker.isCorrect(word) ? [] : checker.getCorrections(word, 1).slice(0, 3);
};
