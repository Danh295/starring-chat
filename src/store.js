'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NAME_RE = /^[A-Za-z0-9_.-]+\.json$/;

// Small JSON file store. Writes are atomic (temp file + rename) and serialized per file.
function createJsonStore(dir) {
  const queues = new Map();
  const check = (name) => {
    if (!NAME_RE.test(name) || name.includes('..')) throw new Error(`Invalid store file name: ${name}`);
    return path.join(dir, name);
  };
  return {
    read(name, fallback) {
      const file = check(name);
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
    },
    write(name, data) {
      let file;
      try { file = check(name); } catch (err) { return Promise.reject(err); }
      const run = async () => {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        try {
          fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
          fs.renameSync(tmp, file);
        } catch (err) {
          try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
          throw err;
        }
      };
      const next = (queues.get(name) || Promise.resolve()).catch(() => {}).then(run);
      queues.set(name, next);
      return next;
    },
  };
}

module.exports = { createJsonStore };
