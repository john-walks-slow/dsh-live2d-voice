#!/usr/bin/env node
/**
 * Translation race condition regression e2e.
 *
 * Verifies two critical orderings:
 *
 * Case 1 (The bug): Translation arrives EARLY (ahead of subtitle events for
 * lines 2 & 3). The TTS queue synthesizes serially, but whole-utterance
 * translation finishes fast at stream end and emits translations for all lines
 * before sentence 2/3 subtitles are emitted. With lateTrRef buffering, all 3
 * sentences must display their translations.
 *
 * Case 2 (Older card rendering): When earlier sentences age into `.lv-sub-old`,
 * their translations must remain visible via `.lv-sub-tr-old`.
 *
 * Case 3 (Late translation): Translation arrives LATE (after subtitles are
 * already queued or flushed). Standard in-place state attachment must still work.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
let pass = 0, fail = 0;
const check = (id, ok, note = '') => {
  if (ok) { pass++; console.log(`  ✓ [${id}] ${note}`); }
  else { fail++; console.log(`  ✗ [${id}] ${note}`); }
};

// 0.4s silence PCM at 44.1kHz, 16-bit mono = 44100 * 0.4 * 2 = 35280 bytes
const silenceBytes = new Uint8Array(35280);
const silenceB64 = Buffer.from(silenceBytes).toString('base64');

const INIT = `
(() => {
  const RealEventSource = window.EventSource;
  window.__RealEventSource = RealEventSource;

  class FakeStreamEventSource extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      window.__fakeStream = this;
      setTimeout(() => {
        if (typeof this.onopen === 'function') this.onopen(new Event('open'));
      }, 20);
    }
    close() {
      this.readyState = 2;
    }
  }

  window.EventSource = function (url, opts) {
    if (typeof url === 'string' && url.includes('/live2d-voice/stream')) {
      return new FakeStreamEventSource(url);
    }
    return new RealEventSource(url, opts);
  };
  window.EventSource.prototype = RealEventSource.prototype;
  window.EventSource.CONNECTING = 0;
  window.EventSource.OPEN = 1;
  window.EventSource.CLOSED = 2;
})();
`;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();

const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = (ms) => page.waitForTimeout(ms);

try {
  console.log('=== STAGE 1: open GUI and navigate to Live2D tab ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);

  // Focus composer and create a fresh session
  await ev(() => {
    const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]');
    if (ed) ed.focus();
  });
  await page.keyboard.type('测试翻译竞态', { delay: 10 });
  await page.keyboard.press('Enter');
  await sleep(6000);

  // Switch to Live2D tab
  const switched = await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D'
    );
    let target = matches[0];
    while (target && target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'tab') {
      target = target.parentElement;
    }
    if (target) {
      target.click();
      return true;
    }
    return false;
  });
  check('T0', switched, 'switched to Live2D tab');
  await sleep(4000);

  const viewReady = await ev(() => {
    return !!document.querySelector('.lv-root') && !!window.__fakeStream;
  });
  check('T1', viewReady, 'Live2D view mounted & FakeStream intercepted');

  if (!viewReady) {
    throw new Error('View did not mount or FakeStream not ready');
  }

  // Helper to dispatch SSE event to the client view
  const dispatch = async (event, data) => {
    await ev(({ event, data }) => {
      const target = window.__fakeStream;
      if (!target) return;
      const me = new MessageEvent(event, { data: JSON.stringify(data) });
      target.dispatchEvent(me);
    }, { event, data });
  };

  console.log('=== STAGE 2: Test Case 1 — Translation races ahead of subtitles ===');
  const u1 = 'utterance-race-1';
  await dispatch('speech-start', { utteranceId: u1, speaker: 'assistant' });
  await dispatch('audio-start', { utteranceId: u1, sampleRate: 44100, speaker: 'assistant' });

  // 1. Line 1 arrives
  await dispatch('subtitle', {
    role: 'assistant',
    text: 'Sentence 1 original text.',
    lineId: `${u1}-1`,
    utteranceId: u1,
    audioSeq: 0,
    speaker: 'assistant',
  });
  await dispatch('audio', {
    utteranceId: u1,
    seq: 0,
    b64: silenceB64,
    speaker: 'assistant',
  });

  // 2. Translations for all 3 lines arrive right now (before line 2 & 3 subtitles exist)
  await dispatch('subtitle-translation', { lineId: `${u1}-1`, text: '第一句翻译' });
  await dispatch('subtitle-translation', { lineId: `${u1}-2`, text: '第二句翻译' });
  await dispatch('subtitle-translation', { lineId: `${u1}-3`, text: '第三句翻译' });

  // Wait a moment for line 1 audio playback / flush
  await sleep(400);

  // 3. Line 2 arrives later (TTS finished sentence 2)
  await dispatch('subtitle', {
    role: 'assistant',
    text: 'Sentence 2 original text.',
    lineId: `${u1}-2`,
    utteranceId: u1,
    audioSeq: 1,
    speaker: 'assistant',
  });
  await dispatch('audio', {
    utteranceId: u1,
    seq: 1,
    b64: silenceB64,
    speaker: 'assistant',
  });
  await sleep(400);

  // 4. Line 3 arrives later (TTS finished sentence 3)
  await dispatch('subtitle', {
    role: 'assistant',
    text: 'Sentence 3 original text.',
    lineId: `${u1}-3`,
    utteranceId: u1,
    audioSeq: 2,
    speaker: 'assistant',
  });
  await dispatch('audio', {
    utteranceId: u1,
    seq: 2,
    b64: silenceB64,
    speaker: 'assistant',
  });

  // Wait for all 3 lines to flush to DOM
  await sleep(800);

  const dom1 = await ev(() => {
    const cards = [...document.querySelectorAll('.lv-sub-old, .lv-sub-card')];
    return cards.map((c) => ({
      text: c.querySelector('.lv-sub-text')?.textContent ?? c.childNodes[0]?.textContent ?? c.textContent,
      tr: c.querySelector('.lv-sub-tr, .lv-sub-tr-old')?.textContent ?? null,
      isOld: c.classList.contains('lv-sub-old'),
      isCurrent: c.classList.contains('lv-sub-card'),
    }));
  });

  console.log('  DOM Subtitles after Race 1:', JSON.stringify(dom1, null, 2));

  check('R1_COUNT', dom1.length === 3, `3 subtitle lines in DOM (actual: ${dom1.length})`);
  check('R1_LINE1', dom1[0]?.tr === '第一句翻译', `Line 1 has translation (actual: "${dom1[0]?.tr}")`);
  check('R1_LINE2', dom1[1]?.tr === '第二句翻译', `Line 2 has translation (actual: "${dom1[1]?.tr}")`);
  check('R1_LINE3', dom1[2]?.tr === '第三句翻译', `Line 3 has translation (actual: "${dom1[2]?.tr}")`);
  check('R1_OLD_TR', dom1[0]?.isOld && !!dom1[0]?.tr, `Older card renders .lv-sub-tr-old`);

  console.log('=== STAGE 3: Test Case 2 — Late translation (subtitles arrived first) ===');
  const u2 = 'utterance-late-2';
  await dispatch('speech-start', { utteranceId: u2, speaker: 'assistant' });
  await dispatch('audio-start', { utteranceId: u2, sampleRate: 44100, speaker: 'assistant' });

  // Subtitles 1, 2, 3 arrive first
  for (let i = 1; i <= 3; i++) {
    await dispatch('subtitle', {
      role: 'assistant',
      text: `Late sentence ${i} original.`,
      lineId: `${u2}-${i}`,
      utteranceId: u2,
      audioSeq: i - 1,
      speaker: 'assistant',
    });
    await dispatch('audio', {
      utteranceId: u2,
      seq: i - 1,
      b64: silenceB64,
      speaker: 'assistant',
    });
    await sleep(250);
  }

  // Then translations arrive after lines are already queued or flushed
  await sleep(500);
  await dispatch('subtitle-translation', { lineId: `${u2}-1`, text: '延迟翻译一' });
  await dispatch('subtitle-translation', { lineId: `${u2}-2`, text: '延迟翻译二' });
  await dispatch('subtitle-translation', { lineId: `${u2}-3`, text: '延迟翻译三' });
  await sleep(400);

  const dom2 = await ev(() => {
    const cards = [...document.querySelectorAll('.lv-sub-old, .lv-sub-card')];
    return cards.map((c) => ({
      text: c.querySelector('.lv-sub-text')?.textContent ?? c.childNodes[0]?.textContent ?? c.textContent,
      tr: c.querySelector('.lv-sub-tr, .lv-sub-tr-old')?.textContent ?? null,
    }));
  });

  console.log('  DOM Subtitles after Late 2:', JSON.stringify(dom2, null, 2));
  const lateLines = dom2.slice(-3);
  check('L1_LINE1', lateLines[0]?.tr === '延迟翻译一', `Late Line 1 has translation ("${lateLines[0]?.tr}")`);
  check('L1_LINE2', lateLines[1]?.tr === '延迟翻译二', `Late Line 2 has translation ("${lateLines[1]?.tr}")`);
  check('L1_LINE3', lateLines[2]?.tr === '延迟翻译三', `Late Line 3 has translation ("${lateLines[2]?.tr}")`);

  await page.screenshot({ path: '/tmp/lv-translation-race-result.png' });
} catch (err) {
  console.error('Test error:', err);
  fail++;
} finally {
  await browser.close();
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
