// The uploadImage adapter: pasted/dropped files go through it and its URL is
// what lands in the document; embedded data: images are replaced in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageUploadPlugin } from '../dist/plugins/image-upload.js';
import { fakeView, pasteEvent, tick } from './helpers.mjs';

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });

test('pasting an image calls uploadImage and inserts the returned URL and alt', async () => {
  const calls = [];
  const states = [];
  const plugin = createImageUploadPlugin({
    uploadImage: async (file) => {
      calls.push(file.name);
      return { url: 'https://cdn.example/shot.png', alt: 'A screenshot' };
    },
    onUploading: (u) => states.push(u),
  });
  const { view, markdown } = await fakeView('hello', [plugin]);
  const event = pasteEvent([png()]);
  assert.equal(plugin.props.handlePaste.call(plugin, view, event), true);
  assert.equal(event.prevented, true);
  await tick();
  assert.deepEqual(calls, ['shot.png']);
  assert.deepEqual(states, [true, false]);
  assert.match(markdown(), /!\[A screenshot\]\(https:\/\/cdn\.example\/shot\.png\)/);
});

test('without alt from the adapter the file name is the alt', async () => {
  const plugin = createImageUploadPlugin({ uploadImage: async () => ({ url: '/img/1.png' }) });
  const { view, markdown } = await fakeView('hello', [plugin]);
  plugin.props.handlePaste.call(plugin, view, pasteEvent([png()]));
  await tick();
  assert.match(markdown(), /!\[shot\.png\]\(\/img\/1\.png\)/);
});

test('a failed upload reports the error and inserts nothing', async () => {
  const errors = [];
  const plugin = createImageUploadPlugin({
    uploadImage: async () => {
      throw new Error('quota exceeded');
    },
    onError: (e) => errors.push(e.message),
  });
  const { view, markdown } = await fakeView('hello', [plugin]);
  plugin.props.handlePaste.call(plugin, view, pasteEvent([png()]));
  await tick();
  assert.deepEqual(errors, ['quota exceeded']);
  assert.equal(markdown().trim(), 'hello');
});

test('non-image pastes and block moves are left to the editor', async () => {
  let called = false;
  const plugin = createImageUploadPlugin({ uploadImage: async () => ((called = true), { url: 'x' }) });
  const { view } = await fakeView('hello', [plugin]);
  const text = new File(['x'], 'a.txt', { type: 'text/plain' });
  assert.equal(plugin.props.handlePaste.call(plugin, view, pasteEvent([text])), false);
  assert.equal(plugin.props.handleDrop.call(plugin, view, { dataTransfer: { files: [png()] }, preventDefault() {} }, null, true), false);
  await tick();
  assert.equal(called, false);
});

test('a dropped image is inserted where it was dropped', async () => {
  const plugin = createImageUploadPlugin({ uploadImage: async () => ({ url: '/drop.png', alt: 'd' }) });
  const { view, markdown } = await fakeView('first\n\nsecond', [plugin]);
  view.posAtCoords = () => ({ pos: 0 });
  const handled = plugin.props.handleDrop.call(plugin, view, { dataTransfer: { files: [png()] }, clientX: 1, clientY: 1, preventDefault() {} }, null, false);
  assert.equal(handled, true);
  await tick();
  assert.ok(markdown().startsWith('![d](/drop.png)'), markdown());
});

const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

test('embedded data: images are uploaded and replaced when allowed', async () => {
  const uploaded = [];
  const plugin = createImageUploadPlugin({
    uploadImage: async (file) => {
      uploaded.push(file.type);
      return { url: 'https://cdn.example/converted.png' };
    },
    canConvertEmbedded: () => true,
  });
  const { view, markdown } = await fakeView(`![pasted](${DATA_URI})`, [plugin]);
  const pluginView = plugin.spec.view(view);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(uploaded, ['image/png']);
  assert.match(markdown(), /!\[pasted\]\(https:\/\/cdn\.example\/converted\.png\)/);
  pluginView.destroy();
});

test('embedded images stay untouched when conversion is not allowed', async () => {
  let called = false;
  const plugin = createImageUploadPlugin({ uploadImage: async () => ((called = true), { url: 'x' }) });
  const { view, markdown } = await fakeView(`![pasted](${DATA_URI})`, [plugin]);
  plugin.spec.view(view).destroy();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(called, false);
  assert.match(markdown(), /data:image\/png/);
});
