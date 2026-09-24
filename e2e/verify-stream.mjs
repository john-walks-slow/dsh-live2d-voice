#!/usr/bin/env node
/**
 * Streaming ASR e2e (same-context fake mic) — verifies the live relay:
 *
 *   🎙 on → synthetic speech → client VAD → live upload POST /asr/stream →
 *   asr-interim SSE (real-time subtitles) → asr-final SSE (final transcript)
 *   → auto-submit → assistant reply.
 *
 * Same fake-mic mechanics as verify-voice.mjs (PCM played into the page's
 * own AudioContext tap, real worklet/VAD chain). Requires the e2e instance
 * on :4188 (token e2etest) and /tmp/t-zh-16k.pcm.
 *
 * Usage: node e2e/verify-stream.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { readFileSync } from 'node:fs';

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const zhB64 = readFileSync('/tmp/t-zh-16k.pcm').toString('base64');
const SHOT = (n) => `/tmp/lvstream-${n}.png`;

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

const INIT = `
(() => {
  window.__lvPatched = 'stream';
  const PCM = { zh: ${JSON.stringify(zhB64)} };
  const log = [];
  const state = { gumCalls: 0, wsConns: [], feeds: [] };
  window.__lvLog = log; window.__lvState = () => JSON.stringify({ log, state });

  const md = navigator.mediaDevices;
  const og = md.getUserMedia.bind(md);
  md.getUserMedia = async function (con) {
    state.gumCalls++;
    if (!con || !con.audio || con.video) return og(con);
    const scratch = new AudioContext();
    const stream = scratch.createMediaStreamDestination().stream;
    stream.__lvFake = true;
    log.push({ t: Date.now(), k: 'gum-ok' });
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
    } catch (e) { log.push({ t: Date.now(), k: 'keepalive-fail', msg: String(e) }); }
    log.push({ t: Date.now(), k: 'tap-installed', ctx: this.state, sr: this.sampleRate });
    return tap;
  };
  window.__lvFeed = (name, gain = 1) => {
    const c = window.__lvPageCtx;
    if (!c || !window.__lvTap) { log.push({ t: Date.now(), k: 'feed-fail', why: 'no-tap' }); return 'no-tap'; }
    const bin = atob(PCM[name]); const n = bin.length >> 1;
    const LEAD = 16000 * 0.3;
    const buf = c.createBuffer(1, n + LEAD, 16000); const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i + LEAD] = ((((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) | 0) / 32768) * gain);
    const src = c.createBufferSource(); src.__lvT = true; src.buffer = buf;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(window.__lvTap);
    src.start();
    state.feeds.push({ t: Date.now(), name, seconds: +(n / 16000).toFixed(2) });
    log.push({ t: Date.now(), k: 'feed-' + name });
    return 'fed:' + (n / 16000).toFixed(2) + 's';
  };
})();
`;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--mute-audio',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.stack || e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text().slice(0, 300)); });
page.on('requestfailed', (r) => pageErrors.push('[request-failed] ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText ?? '')));
const followSessionIds = new Set();
page.on('websocket', (ws) => {
  const wsUrl = ws.url();
  if (wsUrl.includes('/live2d-voice/asr/ws')) {
    wsConns.push({ t: Date.now(), url: wsUrl.slice(0, 140), opened: null });
    ws.on('open', () => { const c = wsConns[wsConns.length - 1]; if (c) c.opened = Date.now(); });
  }
  ws.on('framesent', (f) => {
    const s = String(f.payload);
    if (wsUrl.includes('/live2d-voice/asr/ws')) wsFrames.push({ url: wsUrl, bytes: (f.payload?.byteLength ?? String(f.payload).length) || String(f.payload).length });
    if (s.includes('session/follow')) {
      const m = s.match(/sessionId":"(session-[a-f0-9-]{30,})"/);
      if (m) followSessionIds.add(m[1]);
    }
  });
});
const wsConns = [];
const wsFrames = [];
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = (ms) => page.waitForTimeout(ms);
const lvState = async () => JSON.parse(await ev(() => window.__lvState()));
const micbar = () => ev(() => JSON.stringify({
  present: !!document.querySelector('.lv-micbar'),
  label: document.querySelector('.lv-mic-label')?.textContent ?? null,
}));
const subs = () => ev(() => JSON.stringify([
  ...[...document.querySelectorAll('.lv-sub-card')].map((el) => ({ err: el.classList.contains('lv-sub-err'), user: el.classList.contains('lv-sub-user'), text: el.textContent })),
  ...[...document.querySelectorAll('.lv-sub-old')].map((el) => ({ user: false, text: el.textContent })),
]));
const poll = async (fn, what, timeoutMs, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
};

try {
  console.log('=== open app, create session ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(10000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (ed) { ed.focus(); return true; } return false; });
  await page.keyboard.type('你好', { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(30000);
  const ids = [...followSessionIds];
  const sessionId = ids[ids.length - 1];
  check('S0a', !!sessionId, `session captured (${sessionId?.slice(0, 18)}…)`);

  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(3500);
  const cfgDiag = await ev((sid) => fetch(`/live2d-voice/config?session=${encodeURIComponent(sid)}`).then((r) => r.json()).then((d) => d.config ? { asrMode: d.config.asrMode, sttLanguage: d.config.sttLanguage } : {}).catch(() => ({ error: 'config fetch failed' })), sessionId).catch(() => ({}));
  console.log('CONFIG DIAG:', JSON.stringify(cfgDiag));
  check('S0b', await ev(() => !!document.querySelector('.lv-root')), 'Live2D stage up');
  await ev((sid) => {
    window.__lvEvents = [];
    window.__lvEs = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    const es = window.__lvEs;
    for (const name of ['asr-interim', 'asr-final', 'subtitle', 'error']) {
      es.addEventListener(name, (raw) => { window.__lvEvents.push({ name, data: JSON.parse(raw.data), t: Date.now() }); });
    }
  }, sessionId);
  await sleep(700);

  // mic on
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  const mb = await poll(async () => { const m = JSON.parse(await micbar()); return m.present ? m : null; }, 'micbar', 15000);
  check('S1a', !!mb, `micbar up (${JSON.stringify(mb)})`);
  check('S1b', (await lvState()).state.gumCalls >= 1, 'getUserMedia patched');

  // feed the 4.7s zh utterance
  console.log('=== feed zh utterance ===');
  const feedT = Date.now();
  await ev(() => window.__lvFeed('zh'));
  await sleep(500);

  // 1. live upload POST /asr/stream fired
  const up = await poll(() => (wsConns[0] ? wsConns[0] : null), 'asr ws connect', 15000);
  check('S2a', !!up, `ASR upstream WS fired (${up?.url ?? 'none'})`);
  if (up) {
    const gotData = await poll(() => {
      const e = wsFrames.some((f) => f.url === up.url && f.bytes > 0);
      return e ? true : null;
    }, 'ws data frames', 15000);
    check('S2b', !!gotData, 'upstream WS opened and carried PCM frames');
  }

  // 2. asr-interim arrives while speaking (real-time subtitles)
  const interim = await poll(async () => {
    const es = await ev(() => JSON.stringify(window.__lvEvents ?? []));
    const e = JSON.parse(es).find((x) => x.name === 'asr-interim');
    return e ? { text: e.data.text, dt: e.t - feedT } : null;
  }, 'asr-interim', 15000);
  check('S3a', !!interim, `asr-interim arrived ${interim ? `at +${interim.dt}ms: "${interim.text}"` : ''}`);
  if (interim) {
    const grown = await poll(async () => {
      const es = await ev(() => JSON.stringify(window.__lvEvents ?? []));
      const all = JSON.parse(es).filter((x) => x.name === 'asr-interim');
      const last = all[all.length - 1];
      return last && last.data.text.length > interim.text.length ? last : null;
    }, 'interim growth', 8000);
    check('S3b', !!grown, `interim grows while speaking (${grown ? `"${grown.data.text}"` : 'no growth'})`);
    const labels = [];
    for (let i = 0; i < 10; i++) {
      const m = JSON.parse(await micbar());
      labels.push(m.label);
      await sleep(250);
    }
    const live = labels.find((l) => l && l.length > 6 && !l.includes('识别中') && !l.includes('倾听') && !l.includes('聆听'));
    check('S3c', !!live, `micbar shows live text (${JSON.stringify(live ?? labels)})`);
  }

  // 3. asr-final arrives — full transcript + auto-submit
  const fin = await poll(async () => {
    const es = await ev(() => JSON.stringify(window.__lvEvents ?? []));
    const e = JSON.parse(es).find((x) => x.name === 'asr-final');
    return e ? { text: e.data.text, dt: e.t - feedT } : null;
  }, 'asr-final', 20000);
  check('S4a', !!fin, `asr-final arrived ${fin ? `at +${fin.dt}ms: "${fin.text}"` : ''}`);
  if (fin && fin.text.includes('公园')) check('S4b', true, `final text correct (contains 公园)`);

  let userSub = null;
  for (let i = 0; i < 30 && !userSub; i++) {
    const lines = JSON.parse(await subs());
    userSub = lines.find((l) => l.text.includes('公园')) || null;
    if (!userSub) await sleep(500);
  }
  const allSubs = JSON.parse(await subs());
  check('S4c', !!userSub, userSub ? `utterance auto-submitted + user subtitle ("${userSub.text.slice(0, 40)}")` : `no user subtitle. subs=${JSON.stringify(allSubs)}`);

  // 4. assistant reply shows up (Fish TTS keys configured in the e2e home)
  const reply = await poll(async () => {
    const es = await ev(() => JSON.stringify(window.__lvEvents ?? []));
    const e = JSON.parse(es).find((x) => x.name === 'subtitle' && x.data.role === 'assistant');
    return e ? { text: e.data.text } : null;
  }, 'assistant subtitle', 60000);
  check('S5a', !!reply, reply ? `assistant replied: "${reply.text.slice(0, 60)}"` : 'no assistant reply (may be TTS latency)');

  // state dump
  const st = await lvState();
  console.log('wsConns:', JSON.stringify(wsConns));
    console.log('feeds:', JSON.stringify(st.state.feeds));
  console.log('pageErrors:', JSON.stringify(pageErrors));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
} finally {
  await browser.close();
}