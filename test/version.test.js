import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/version.js';

test('the version is semver and matches package.json and the service worker cache', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, VERSION);
  assert.match(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp(`branches-${VERSION.replace(/\./g, '\\.')}`));
});
