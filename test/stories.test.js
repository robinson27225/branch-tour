import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportStories, importStories, STORIES_FORMAT } from '../src/stories.js';
import { MediaStore, storyKey } from '../src/voice.js';

const pack = { name: 'Molalla', people: [{ id: 'Bagby-165' }, { id: 'Noyer-59' }, { id: 'Fox-1' }] };

test('stories written on one device load on another, and only for people in the pack', async () => {
  const laptop = new MediaStore('t-laptop-' + Math.random());
  await laptop.putJson(storyKey('Molalla', 'Bagby-165'), { text: 'Margaret Bagby rests here.', source: 'gemma3 via Ollama', extra: 'dropped' });
  await laptop.putJson(storyKey('Molalla', 'Fox-1'), { text: 'Plain story.', source: 'template', reason: 'model off' });
  const file = await exportStories(laptop, pack);
  assert.equal(file.format, STORIES_FORMAT);
  assert.deepEqual(Object.keys(file.stories).sort(), ['Bagby-165', 'Fox-1']);          // Noyer has no story yet
  assert.equal(file.stories['Bagby-165'].extra, undefined);

  const phone = new MediaStore('t-phone-' + Math.random());
  const json = JSON.parse(JSON.stringify({ ...file, stories: { ...file.stories, 'Stranger-9': { text: 'x', source: 'template' }, 'Noyer-59': { text: '  ', source: 'template' } } }));
  const r = await importStories(phone, pack, json);
  assert.deepEqual(r, { loaded: 2, skipped: 2 });
  assert.equal((await phone.getJson(storyKey('Molalla', 'Bagby-165'))).source, 'gemma3 via Ollama');
  assert.equal(await phone.getJson(storyKey('Molalla', 'Stranger-9')), null);
});

test('a file that is not a stories file is refused with a plain message', async () => {
  const m = new MediaStore('t-x-' + Math.random());
  await assert.rejects(importStories(m, pack, { hello: 1 }), /not a saved stories file/);
  await assert.rejects(importStories(m, pack, null), /not a saved stories file/);
});
