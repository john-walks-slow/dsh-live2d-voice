#!/usr/bin/env node
/**
 * Duplicate-submit / duplicate-echo regression e2e.
 *
 * Three historical duplicate bugs, all in one flow (GUI Live2D tab + the
 * standalone /app page watching the SAME session):
 *
 *   R1 (old): a kept-alive second view instance heard the same asr-final and
 *      re-submitted the utterance — the `up` upload-id guard fixed it.
 *   R2 (260925): in stream mode the buffered `onSegment` path ran BESIDE the
 *      live upload, so every spoken line was submitted twice into history
 *      (asr-final submit + /asr/recognize submit). Stream mode must issue
 *      ZERO /asr/recognize calls.
 *   R3 (260925): the standalone page submits via POST /message, whose route
 *      echoes the user line over SSE — the view's local push displayed it a
 *      second time (two identical user cards, one history entry).
 *
 * User-card counting is element-identity based (dataset marker): the same
 * text landing twice creates two card elements and must count 2 — deduping
 * by text (the old check) hid exactly this bug.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { readFileSync } from 'node:fs';

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const zhB64 = readFileSync('/tmp/t-zh-16k.pcm').toString('base64');
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

const INIT = `
(() => {
  window.__lvPatched = 'nodup';
  const PCM = { zh: ${JSON.stringify(zhB64)} };
  const state = { gumCalls: 0, messages: 0, recognizes: 0, feeds: [] };
  window.__lvState = () => JSON.stringify({ state });
  const of = window.fetch;
  window.fetch = function () {
    const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
    if (String(u).includes('/live2d-voice/message')) {
      state.messages++;
      const body = typeof arguments[1] === 'object' && arguments[1] ? String(arguments[1].body ?? '') : '';
      state.lastMessageBody = body.slice(0, 120);
      return of.apply(this, arguments).then((r) => { state.lastMessageStatus = r.status; return r; });
    }
    if (String(u).includes('/live2d-voice/asr/recognize')) state.recognizes++;
    return of.apply(this, arguments);
  };
  // Count user-card ELEMENTS matching a needle — element identity, so the
  // same text rendered twice counts twice (unlike a text Set). Totals are
  // tracked PER NEEDLE (a global accumulator bleeds counts across checks).
  window.__lvUserCards = (needle) => {
    let added = 0;
    for (const el of document.querySelectorAll('.lv-sub-card, .lv-sub-old')) {
      if (el.dataset.lvSeen) continue;
      el.dataset.lvSeen = '1';
      if (el.classList.contains('lv-sub-user') && (el.textContent ?? '').includes(needle)) added++;
    }
    const totals = (window.__lvUserTotals ??= {});
    return (totals[needle] = (totals[needle] ?? 0) + added);
  };
  const md = navigator.mediaDevices;
  const og = md.getUserMedia.bind(md);
  md.getUserMedia = async function (con) {
    state.gumCalls++;
    if (!con || !con.audio || con.video) return og(con);
    const scratch = new AudioContext();
    const stream = scratch.createMediaStreamDestination().stream;
    stream.__lvFake = true;
    return stream;
  };
  const protoCtx = AudioContext.prototype;
  const oCMSS = protoCtx.createMediaStreamSource;
  protoCtx.createMediaStreamSource = function (stream) {
    if (!stream || !stream.__lvFake) return oCMSS.call(this, stream);
    window.__lvPageCtx = this;
    const tap = this.createGain();
    tap.gain.value = 1;
    window.__lvTap = tap;
    try {
      const osc = this.createOscillator();
      const g = this.createGain();
      g.gain.value = 0;
      osc.connect(g); g.connect(tap); osc.start();
      window.__lvKeepAlive = osc;
    } catch {}
    return tap;
  };
  window.__lvFeed = () => {
    const c = window.__lvPageCtx;
    if (!c || !window.__lvTap) return 'no-tap';
    const bin = atob(PCM.zh); const n = bin.length >> 1;
    const LEAD = 16000 * 0.3;
    const buf = c.createBuffer(1, n + LEAD, 16000); const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i + LEAD] = ((((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) | 0) / 32768));
    const src = c.createBufferSource(); src.__lvT = true; src.buffer = buf;
    src.connect(c.createGain()).connect(window.__lvTap);
    src.start();
    state.feeds.push(Date.now());
    return 'fed';
  };
})();
`;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--mute-audio', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const followSessionIds = new Set();
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => {
    const s = String(f.payload);
    if (s.includes('session/follow')) {
      const m = s.match(/sessionId":"(session-[a-f0-9-]{30,})"/);
      if (m) followSessionIds.add(m[1]);
    }
  });
});
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = (ms) => page.waitForTimeout(ms);
const st = async () => JSON.parse(await ev(() => (window.__lvState ? window.__lvState() : '{}'))).state ?? {};
const postConfig = (page_, patch) => page_.evaluate((p) => fetch('/live2d-voice/config', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p),
}).then((r) => r.status), patch);
let originalMode = null;

try {
  console.log('=== boot ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (ed) { ed.focus(); return true; } return false; });
  await page.keyboard.type('你好', { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(20000);
  const sid = [...followSessionIds][[...followSessionIds].length - 1];
  check('D0a', !!sid, `session captured (${sid?.slice(0, 18)}…)`);

  // Pin stream mode BEFORE the Live view mounts (asrMode is read at mount),
  // remembering the original value to restore in finally.
  originalMode = await ev(() => fetch('/live2d-voice/config').then((r) => r.json()).then((d) => d.config?.asrMode ?? 'stream'));
  await postConfig(page, { asrMode: 'stream' });
  console.log(`asrMode: ${originalMode} → stream`);

  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(3500);
  check('D0b', await ev(() => !!document.querySelector('.lv-root')), 'GUI Live2D stage up');

  // second view instance: standalone page watching the same session
  const page2 = await ctx.newPage();
  await page2.goto(`http://127.0.0.1:4188/live2d-voice/app?session=${encodeURIComponent(sid)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  check('D0c', await page2.evaluate(() => !!document.querySelector('.lv-root')), 'standalone second view up');

  // ---- R2: speak into the GUI tab in STREAM mode ----
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  await sleep(2500);
  await ev(() => window.__lvFeed());
  console.log('=== spoken (stream mode); waiting for submit ===');
  for (let i = 0; i < 40 && (await ev(() => window.__lvUserCards('公园'))) === 0; i++) await sleep(500);
  const r2cards = async () => (await ev(() => window.__lvUserCards('公园')));
  for (let i = 0; i < 20 && (await r2cards()) < 1; i++) await sleep(500);
  // keep watching: the historical duplicate landed 10-12s after the first
  for (let i = 0; i < 20; i++) { await sleep(500); await r2cards(); }
  const cards1 = await r2cards();
  const s1 = await st();
  check('D1a', cards1 === 1, `stream mode: exactly one transcript card (${cards1})`);
  check('D1b', s1.recognizes === 0, `stream mode: zero buffered /asr/recognize calls (${s1.recognizes})`);
  check('D1c', s1.messages <= 1, `GUI tab /message POSTs = ${s1.messages} (expected 0 — viaClient path)`);
  // The GUI tab submits via the host session API (viaClient) — that path has
  // NO SSE user echo, so the standalone view must show the transcript ZERO
  // times (if it ever shows one, a stray echo route appeared).
  const st2cards = async () => (await page2.evaluate(() => window.__lvUserCards('公园')));
  for (let i = 0; i < 6; i++) { await sleep(500); await st2cards(); }
  check('D1d', (await st2cards()) === 0, `standalone shows the viaClient transcript 0 times (${await st2cards()})`);

  // ---- R3: type on the standalone page — the /message route's SSE echo is
  // the ONLY user card it must show (local push doubled it before) ----
  // NB: the HUD button's title is 打字输入 while closed (收起键盘输入 once open).
  await page2.evaluate(() => document.querySelector('.lv-hud [title*="打字"]')?.click());
  await sleep(400);
  await page2.keyboard.type('独立页双发回归测试', { delay: 12 });
  await page2.keyboard.press('Enter');
  const TYPED = '独立页双发回归测试';
  for (let i = 0; i < 10 && (await page2.evaluate(() => window.__lvUserCards('独立页双发回归测试'))) === 0; i++) await sleep(500);
  for (let i = 0; i < 16; i++) { await sleep(500); await page2.evaluate(() => window.__lvUserCards('独立页双发回归测试')); }
  const p2cards = await page2.evaluate(() => window.__lvUserCards('独立页双发回归测试'));
  const p2msgs = await page2.evaluate(() => JSON.parse(window.__lvState()).state);
  console.log('R3 diag page2:', JSON.stringify(p2msgs), 'cards:', p2cards);
  console.log('R3 diag page2 DOM:', await page2.evaluate(() => JSON.stringify([...document.querySelectorAll('.lv-sub-card, .lv-sub-old')].map((el) => ({ cls: el.className, text: (el.textContent ?? '').slice(0, 30) })))));
  console.log('R3 diag page1 DOM:', await ev(() => JSON.stringify([...document.querySelectorAll('.lv-sub-card, .lv-sub-old')].map((el) => ({ cls: el.className, text: (el.textContent ?? '').slice(0, 30) })))));
  check('D2a', p2cards === 1, `standalone typed line shows exactly once (${p2cards})`);
  check('D2b', p2msgs === 1, `standalone submitted exactly one /message (${p2msgs})`);
  // the GUI tab sees the same line once over SSE (it did not submit it)
  for (let i = 0; i < 10; i++) { await sleep(500); await ev(() => window.__lvUserCards('独立页双发回归测试')); }
  check('D2c', (await ev(() => window.__lvUserCards('独立页双发回归测试'))) === 1, 'GUI tab shows the standalone line once (SSE echo)');

  await postConfig(page, { asrMode: originalMode }).catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
} finally {
  if (originalMode !== null) await postConfig(page, { asrMode: originalMode }).catch(() => undefined);
  await browser.close();
}
