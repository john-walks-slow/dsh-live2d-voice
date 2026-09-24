#!/usr/bin/env node
/**
 * Duplicate-submit regression e2e (bug: every voice utterance landed twice).
 *
 * Two Live2D view instances watch the SAME session (GUI Live2D tab + the
 * standalone /app page). Voice is only spoken into the GUI tab; the
 * standalone page must NOT submit the same asr-final again. Asserts:
 *   - exactly one user subtitle with the transcript (no immediate dup),
 *   - and no second identical user message within 15s (the old symptom —
 *     a kept-alive second view re-submitted and the followup queued behind
 *     the running turn, landing ~10-12s later).
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
  const log = [];
  const state = { gumCalls: 0, messages: [], feeds: [] };
  window.__lvState = () => JSON.stringify({ log, state });
  const of = window.fetch;
  window.fetch = function () {
    const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
    if (String(u).includes('/live2d-voice/message')) {
      const e = { t: Date.now(), status: null };
      state.messages.push(e);
      return of.apply(this, arguments).then((r) => { e.status = r.status; return r; });
    }
    return of.apply(this, arguments);
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
const subs = () => ev(() => JSON.stringify([...document.querySelectorAll('.lv-sub-card, .lv-sub-old')].map((el) => ({ user: el.classList.contains('lv-sub-user'), text: el.textContent }))));

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
  const st2 = await page2.evaluate(() => JSON.stringify({ root: !!document.querySelector('.lv-root') }));
  check('D1a', JSON.parse(st2).root === true, `standalone second view up (${st2})`);

  // speak into the GUI tab
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  await sleep(2500);
  await ev(() => window.__lvFeed());
  console.log('=== spoken; waiting for submit ===');

  // watch for user subtitles with the transcript
  const findUser = async () => {
    const lines = JSON.parse(await subs());
    return lines.filter((l) => l.user && l.text.includes('公园'));
  };
  let userLines = [];
  for (let i = 0; i < 40 && userLines.length === 0; i++) {
    userLines = await findUser();
    if (userLines.length === 0) await sleep(500);
  }
  check('D2a', userLines.length === 1, `exactly one user subtitle (${userLines.length}) ${userLines[0] ? `"${userLines[0].text.slice(0, 30)}"` : ''}`);
  const msgCount = async () => (JSON.parse(await ev(() => (window.__lvState ? window.__lvState() : '{}'))).state?.messages ?? []).length;
  console.log('message POSTs at submit:', await msgCount());

  // the old bug: a second identical submit lands ~10-12s later
  let totalUserSeen = 0;
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    for (const l of await findUser()) {
      if (!seen.has(l.text)) { seen.add(l.text); totalUserSeen++; }
    }
    await sleep(500);
  }
  check('D3a', totalUserSeen === 1, `no delayed duplicate within 15s (${totalUserSeen} distinct user lines seen)`);
  const msgs = JSON.parse(await ev(() => window.__lvState ? window.__lvState() : '{}')).state?.messages ?? [];
  console.log('messages:', JSON.stringify(msgs));
  check('D3b', msgs.length <= 1, `/message POSTs = ${msgs.length} (expected ≤1)`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
} finally {
  await browser.close();
}