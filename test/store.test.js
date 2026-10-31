const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('../src/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-store-'));

test('round-trips JSON and returns the fallback when missing', async () => {
  const s = createJsonStore(tmp());
  assert.deepStrictEqual(s.read('a.json', { x: 1 }), { x: 1 });
  await s.write('a.json', { y: 2 });
  assert.deepStrictEqual(s.read('a.json', null), { y: 2 });
});

test('a corrupt file yields the fallback instead of throwing', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
  assert.deepStrictEqual(createJsonStore(dir).read('bad.json', []), []);
});

test('concurrent writes to one file finish in order', async () => {
  const s = createJsonStore(tmp());
  await Promise.all([1, 2, 3, 4, 5].map((n) => s.write('o.json', { n })));
  assert.deepStrictEqual(s.read('o.json', null), { n: 5 });
});

test('file names cannot escape the data directory', async () => {
  const s = createJsonStore(tmp());
  await assert.rejects(() => s.write('../evil.json', {}), /name/);
  await assert.rejects(() => s.write('a/b.json', {}), /name/);
  assert.throws(() => s.read('../evil.json', null), /name/);
});

test('no temp files are left behind', async () => {
  const dir = tmp();
  const s = createJsonStore(dir);
  await s.write('a.json', { a: 1 });
  assert.deepStrictEqual(fs.readdirSync(dir), ['a.json']);
});
