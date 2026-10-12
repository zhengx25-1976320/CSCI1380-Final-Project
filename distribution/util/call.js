// Adapt callback services to promises; group services return an error map.
module.exports = function(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (error, value) => {
      if (error instanceof Error) return reject(error);
      if (error && Object.keys(error).length) {
        return reject(new Error(Object.values(error).map((e) => e.message || String(e)).join('; ')));
      }
      resolve(value);
    });
  });
};
