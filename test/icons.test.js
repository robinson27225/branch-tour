import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = (f) => new URL('../' + f, import.meta.url);
const manifest = JSON.parse(readFileSync(root('manifest.webmanifest'), 'utf8'));
const png = (f) => { const b = readFileSync(root(f)); assert.equal(b.toString('latin1', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('every manifest icon exists and the PNG sizes are what the manifest says', () => {
  assert.ok(manifest.icons.length >= 3);
  for (const ic of manifest.icons) {
    assert.ok(existsSync(root(ic.src)), ic.src);
    if (ic.type === 'image/png') assert.deepEqual(png(ic.src), ic.sizes.split('x').map(Number), ic.src);
  }
});

test('there is a plain icon at 192 and 512 and a maskable one, as installing on a phone needs', () => {
  const has = (size, purpose) => manifest.icons.some((i) => i.sizes === size && i.purpose === purpose);
  assert.ok(has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable'));
});

test('the page points at its icons, and the service worker keeps them for offline', () => {
  const html = readFileSync(root('index.html'), 'utf8');
  const sw = readFileSync(root('sw.js'), 'utf8');
  assert.match(html, /rel="apple-touch-icon" href="img\/apple-touch-icon\.png"/);
  assert.match(html, /rel="icon" href="img\/favicon\.svg"/);
  for (const href of [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(existsSync(root(href)), href);
    assert.ok(sw.includes(`'${href}'`), `${href} is in the service worker's saved files`);
  }
  for (const ic of manifest.icons) assert.ok(sw.includes(`'${ic.src}'`), ic.src);
  assert.deepEqual(png('img/apple-touch-icon.png'), [180, 180]);
  assert.ok(existsSync(root('favicon.ico')));
});
