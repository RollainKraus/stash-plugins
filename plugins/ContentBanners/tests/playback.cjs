const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
  const frames = [];
  const document = {
    readyState: 'loading',
    addEventListener() {},
    createElement(tag) {
      return {
        tag, readyState: 0, calls: 0, listeners: {},
        get isConnected() { return this.parentNode?.isConnected || false; },
        closest() { return this.parentNode; },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        play() { this.calls++; return this.result?.() || Promise.resolve(); },
        pause() {},
      };
    },
  };
  const context = vm.createContext({ document, requestAnimationFrame: fn => frames.push(fn) });
  const source = fs.readFileSync(require.resolve('../ContentBanners.js'), 'utf8');
  vm.runInContext(source.replace('  function main() {',
    '  globalThis.api = { state, renderMediaSlot, syncPlaybackState };\n  function main() {'), context);
  context.api.state.config.bannerMode = 'mixed';
  const classes = new Set();
  const slot = {
    isConnected: true, child: null,
    classList: {
      remove(name) { classes.delete(name); },
      add(name) { classes.add(name); },
      contains(name) { return classes.has(name); },
    },
    replaceChildren() { if (this.child) this.child.parentNode = null; this.child = null; },
    appendChild(child) { this.child = child; child.parentNode = this; },
  };
  context.api.state.layer = { querySelectorAll: () => slot.child?.tag === 'video' ? [slot.child] : [] };
  const render = () => {
    context.api.renderMediaSlot(slot, { preview: 'preview.mp4', screenshot: 'still.jpg' });
    slot.classList.add('is-active');
    return slot.child;
  };
  const ready = (video) => { video.readyState = 3; video.listeners.canplay(); };
  return { ...context.api, slot, render, ready, frames };
}

test('cold left preview waits for readiness and recovers from an interrupted start', async () => {
  const left = setup(), right = setup();
  const a = left.render(), b = right.render();
  assert.equal(a.calls, 0);
  right.ready(b);
  a.result = () => Promise.reject({ name: 'AbortError' });
  left.ready(a);
  await Promise.resolve();
  assert.equal(left.slot.child, a);
  a.result = () => Promise.resolve();
  left.frames.shift()();
  assert.equal(a.calls, 2);
  assert.equal(b.calls, 1);
});

test('late failures cannot replace a newer preview', async () => {
  const app = setup();
  const old = app.render();
  let reject;
  old.result = () => new Promise((_, fail) => { reject = fail; });
  app.ready(old);
  const current = app.render();
  reject({ name: 'NotSupportedError' });
  old.onerror();
  await Promise.resolve();
  assert.equal(app.slot.child, current);
});

test('readiness and queued retries respect pause and removal', async () => {
  const app = setup();
  const video = app.render();
  app.state.isPaused = true;
  app.ready(video);
  assert.equal(video.calls, 0);
  app.state.isPaused = false;
  video.result = () => Promise.reject({ name: 'AbortError' });
  video.listeners.canplay();
  await Promise.resolve();
  app.slot.isConnected = false;
  app.frames.shift()();
  assert.equal(video.calls, 1);
});

test('actual media failure still falls back to screenshot', () => {
  const app = setup();
  app.render().onerror();
  assert.equal(app.slot.child.tag, 'img');
});

test('activation starts ready media and leaves loading media for canplay', () => {
  const app = setup();
  const video = app.render();
  app.syncPlaybackState();
  assert.equal(video.calls, 0);
  video.readyState = 3;
  app.slot.classList.remove('is-active');
  app.ready(video);
  assert.equal(video.calls, 0);
  app.slot.classList.add('is-active');
  app.syncPlaybackState();
  assert.equal(video.calls, 1);
});

test('hidden, offscreen and inactive videos do not restart', () => {
  for (const flag of ['isDocumentVisible', 'isInViewport']) {
    const app = setup();
    const video = app.render();
    app.state[flag] = false;
    app.ready(video);
    assert.equal(video.calls, 0);
    app.state[flag] = true;
    app.syncPlaybackState();
    assert.equal(video.calls, 1);
  }
});

test('autoplay policy rejection does not blacklist valid media', async () => {
  const app = setup();
  const video = app.render();
  video.result = () => Promise.reject({ name: 'NotAllowedError' });
  app.ready(video);
  await Promise.resolve();
  assert.equal(app.slot.child, video);
  assert.equal(app.state.failedMedia.size, 0);
});
