#!/usr/bin/env node
/**
 * Phase 2 voice-loop e2e (same-context fake mic).
 *
 * Verifies the full voice conversation loop against a running e2e instance:
 *   🎙 on → synthetic speech → client VAD segmentation → POST recognize →
 *   auto-submit → assistant reply (SSE + engine audio) → barge-in (muzzle)
 *   → second utterance → steer → new turn reply.
 *
 * The container has no audio hardware, so getUserMedia is patched to return
 * a marker stream and createMediaStreamSource is patched to hand the page a
 * GainNode tap inside the page's own AudioContext — PCM plays through a
 * BufferSource into that tap (with a 0.3s silence lead for VAD pre-roll
 * margin), and the page's real worklet/VAD/segment/POST chain runs
 * unchanged. A silent keep-alive oscillator holds the subgraph active —
 * otherwise Chromium's silent-input optimization stops worklet process()
 * once the test source ends and the VAD would never release.
 *
 * Usage: node e2e/verify-voice.mjs   (e2e instance on :4188, token e2etest,
 * expects /tmp/t-zh-16k.pcm + /tmp/t-ja-16k.pcm; see verify-asr.mjs header
 * for regenerating them)
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const CFG = process.env.E2E_CFG ?? '/root/.dsh-e2e/live2d-voice.json';
const zhB64 = readFileSync('/tmp/t-zh-16k.pcm').toString('base64');
const jaB64 = readFileSync('/tmp/t-ja-16k.pcm').toString('base64');
const SHOT = (n) => `/tmp/lvloop-${n}.png`;

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

const INIT = `
(() => {
  window.__lvPatched = 'loop';
  const PCM = { zh: ${JSON.stringify(zhB64)}, ja: ${JSON.stringify(jaB64)} };
  const log = [];
  const state = { gumCalls: 0, recognizes: [], engineStarts: 0, engineStops: 0, feeds: [] };
  window.__lvLog = log; window.__lvState = () => JSON.stringify({ log, state });
  // instrument engine playback (exclude test sources)
  const proto = AudioBufferSourceNode.prototype;
  const oStart = proto.start, oStop = proto.stop;
  proto.start = function (...a) { if (!this.__lvT) { state.engineStarts++; log.push({ t: Date.now(), k: 'engine-start' }); } return oStart.apply(this, a); };
  proto.stop = function (...a) { if (!this.__lvT) { state.engineStops++; log.push({ t: Date.now(), k: 'engine-stop' }); } return oStop.apply(this, a); };
  // log recognize POSTs
  const of = window.fetch;
  window.fetch = function () {
    const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
    if (String(u).includes('/live2d-voice/asr/recognize')) {
      const e = { t: Date.now(), url: String(u).slice(0, 120), status: null };
      state.recognizes.push(e);
      return of.apply(this, arguments).then((r) => { e.status = r.status; e.done = Date.now(); return r; });
    }
    return of.apply(this, arguments);
  };
  // marker fake getUserMedia: real MediaStream object, content irrelevant
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
  // same-context injection: the page's MicCapture calls this with our marker
  // stream; return a GainNode tap in the page's own AudioContext instead.
  const protoCtx = AudioContext.prototype;
  const oCMSS = protoCtx.createMediaStreamSource;
  protoCtx.createMediaStreamSource = function (stream) {
    if (!stream || !stream.__lvFake) return oCMSS.call(this, stream);
    window.__lvPageCtx = this;
    const tap = this.createGain();
    tap.gain.value = 1;
    window.__lvTap = tap;
    // Keep-alive: an always-running silent source keeps the subgraph active,
    // otherwise Chromium may stop calling worklet process() once the test
    // BufferSource ends (silent-input optimization) and VAD never releases.
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
  // play PCM into the tap (page ctx, single graph)
  let __lvRoots = 0;
  const __mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.removedNodes) if (n.nodeType === 1 && n.classList?.contains('lv-root')) { __lvRoots++; log.push({ t: Date.now(), k: 'lv-root-removed' }); }
  });
  try { __mo.observe(document, { childList: true, subtree: true }); } catch {}
  window.__lvRoots = () => __lvRoots;
  window.__lvFeed = (name, gain = 1) => {
    const c = window.__lvPageCtx;
    if (!c || !window.__lvTap) { log.push({ t: Date.now(), k: 'feed-fail', why: 'no-tap' }); return 'no-tap'; }
    const bin = atob(PCM[name]); const n = bin.length >> 1;
    const LEAD = 16000 * 0.3; // silence head: margin for the VAD pre-roll
    const buf = c.createBuffer(1, n + LEAD, 16000); const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i + LEAD] = ((((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) | 0) / 32768) * gain);
    const src = c.createBufferSource(); src.__lvT = true; src.buffer = buf;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(window.__lvTap);
    src.start();
    state.feeds.push({ t: Date.now(), name, gain, seconds: +(n / 16000).toFixed(2) });
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
page.on('pageerror', (e) => pageErrors.push(e.message));
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 200)));
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
const lvState = async () => JSON.parse(await ev(() => window.__lvState()));
const subs = () => ev(() => JSON.stringify([...document.querySelectorAll('.lv-sub')].map((el) => ({
  user: el.classList.contains('lv-user'), err: el.classList.contains('lv-err'), text: el.textContent,
}))));
const micbar = () => ev(() => JSON.stringify({
  present: !!document.querySelector('.lv-micbar'),
  label: document.querySelector('.lv-mic-label')?.textContent ?? null,
  fill: document.querySelector('.lv-mic-fill')?.style?.width ?? null,
}));
async function attachProbe(sessionId) {
  await ev((sid) => {
    window.__lvEvents = [];
    window.__lvEs = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    const es = window.__lvEs;
    for (const name of ['speech-start', 'audio-start', 'audio', 'audio-end', 'speech-end', 'subtitle', 'error']) {
      es.addEventListener(name, (raw) => {
        if (name === 'audio') { window.__lvEvents.push({ name, t: Date.now(), len: raw.data.length }); return; }
        window.__lvEvents.push({ name, data: JSON.parse(raw.data), t: Date.now() });
      });
    }
  }, sessionId);
  await sleep(700);
}
const sse = () => ev(() => JSON.stringify(window.__lvEvents ?? []));
const shot = (n) => page.screenshot({ path: SHOT(n), timeout: 60000 }).catch(() => {});

try {
  // config: sttLanguage=auto (product default)
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  cfg.sttLanguage = 'auto';
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');

  console.log('=== boot + session ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(12000);
  await page.screenshot({ path: '/tmp/lvloop-boot.png' });
  const probe = await ev(() => JSON.stringify({
    title: document.title,
    url: location.href,
    ed: !!document.querySelector('[contenteditable="true"][aria-label*="Describe"]'),
    edAny: [...document.querySelectorAll('[contenteditable="true"]')].map(e => e.getAttribute('aria-label') ?? e.className.slice(0, 30)).slice(0, 5),
    bodyLen: document.body?.textContent?.length ?? 0,
  }));
  console.log('BOOT PROBE:', probe);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (!ed) return false; ed.focus(); return true; });
  await page.keyboard.type('你好', { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(55000);
  const ids = [...followSessionIds];
  const sessionId = ids[ids.length - 1];
  check('L0a', !!sessionId, `session captured (${sessionId?.slice(0, 18)}…)`);

  // Live2D tab
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(3500);
  const stage = JSON.parse(await ev(() => JSON.stringify({
    root: !!document.querySelector('.lv-root'), hud: !!document.querySelector('.lv-hud'),
    micBtn: !!document.querySelector('.lv-hud .lv-mic'),
  })));
  check('L0b', stage.root && stage.hud && stage.micBtn, `stage up (${JSON.stringify(stage)})`);
  await attachProbe(sessionId);

  // F1 spot check: mic button hit-testable now (real pointer position)
  const hit = await ev(() => {
    const btn = document.querySelector('.lv-hud .lv-mic');
    if (!btn) return { ok: false };
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: btn === el || btn.contains(el), hit: el?.className?.slice?.(0, 40) ?? String(el?.tagName) };
  });
  check('L0c', hit.ok, `F1 fixed: mic button hit-test (${JSON.stringify(hit)})`);
  await shot('01-stage');

  // mic on
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  let mb = null;
  for (let i = 0; i < 20; i++) { await sleep(200); mb = JSON.parse(await micbar()); if (mb.present) break; }
  check('L0d', mb.present, `micbar up (label="${mb?.label}")`);
  const st0 = await lvState();
  check('L0e', st0.state.gumCalls >= 1, `gum patched (${st0.state.gumCalls} calls)`);

  // ---- L1/L2: zh feed → recognize → auto-submit ----
  console.log('=== zh feed ===');
  const feed1 = await ev(() => window.__lvFeed('zh'));
  check('L1a', String(feed1).startsWith('fed:'), `fed zh (${feed1}, tap ctx=${st0.log.some(l => l.k === 'tap-installed') ? 'installed' : '?'})`);
  // watch for recognize POST + pending label
  let recZh = null, sawPending = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const st = await lvState();
    recZh = st.state.recognizes.find(r => r.url.includes('lang=') && r.status !== null) ?? null;
    const label = JSON.parse(await micbar()).label;
    if (i % 4 === 0) console.log('  L1 probe', i, JSON.stringify({ label, starts: st.state.engineStarts, stops: st.state.engineStops, gum: st.state.gumCalls }));
    if (label === '识别中…') sawPending = true;
    if (recZh && i > 4) break;
  }
  check('L1b', !!recZh && recZh.status === 200, `recognize POST 200 (${recZh?.url})`);
  check('L1c', sawPending, `micbar showed 识别中… during POST`);
  await shot('02-zh-recognized');

  // user subtitle with the zh text (auto-submit)
  let userSubZh = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const lines = JSON.parse(await subs());
    userSubZh = lines.find((l) => l.user && /散步|天气/.test(l.text ?? '')) ?? null;
    if (userSubZh) break;
  }
  check('L2', !!userSubZh, `user subtitle auto-submitted ("${userSubZh?.text?.slice(0, 30)}…")`);
  await shot('03-zh-submitted');

  // ---- L3: assistant reply (SSE + engine audio) ----
  let replyStarted = false, enginePlayed = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const evts = JSON.parse(await sse());
    if (evts.some(e => e.name === 'speech-start')) replyStarted = true;
    const st = await lvState();
    if (st.state.engineStarts > 0) enginePlayed = true;
    if (replyStarted && enginePlayed) break;
  }
  check('L3a', replyStarted, 'assistant reply speech-start (SSE)');
  check('L3b', enginePlayed, 'engine scheduled TTS audio (in-graph playback)');
  await shot('04-reply-playing');

  // ---- L4: barge-in — ja feed while engine still playing ----
  console.log('=== barge-in (ja feed during playback) ===');
  const speechStartsBefore = JSON.parse(await sse()).filter(e => e.name === 'speech-start').length;
  const stPre = await lvState();
  const stopsPre = stPre.state.engineStops;
  const startsPre = stPre.state.engineStarts;
  const feed2 = await ev(() => window.__lvFeed('ja'));
  check('L4a', String(feed2).startsWith('fed:'), `fed ja during playback (${feed2})`);
  // barge should stop the engine quickly (level > 0.03 sustained)
  let barged = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const st = await lvState();
    if (st.state.engineStops > stopsPre) { barged = true; break; }
  }
  check('L4b', barged, `engine stopped after loud user audio (barge-in)`);
  await shot('05-barged');

  // ja recognize + steer submit
  let recJa = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const st = await lvState();
    if (i % 2 === 0) {
      const probe = await ev(() => JSON.stringify({
        micbar: !!document.querySelector('.lv-micbar'),
        label: document.querySelector('.lv-mic-label')?.textContent ?? null,
        dotMuted: !!document.querySelector('.lv-micdot.lv-muted-dot'),
        roots: window.__lvRoots ? window.__lvRoots() : -1,
        ctxState: window.__lvPageCtx ? window.__lvPageCtx.state : null,
      }));
      console.log('  L4 probe', i, probe);
    }
    recJa = st.state.recognizes.find(r => r.status !== null && r.t > (recZh?.t ?? 0)) ?? null;
    if (recJa) break;
  }
  check('L4c', !!recJa && recJa.status === 200, `second recognize POST 200 (${recJa?.url})`);
  let userSubJa = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const lines = JSON.parse(await subs());
    userSubJa = lines.find((l) => l.user && /こんにちは|天気/.test(l.text ?? '')) ?? null;
    if (userSubJa) break;
  }
  check('L4d', !!userSubJa, `ja utterance auto-submitted ("${userSubJa?.text?.slice(0, 24)}…")`);

  // ---- L5: new turn reply (baseline snapshotted BEFORE the ja feed) ----
  let newSpeech = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const evts = JSON.parse(await sse());
    if (evts.filter(e => e.name === 'speech-start').length > speechStartsBefore) { newSpeech = true; break; }
  }
  check('L5', newSpeech, 'steered new turn: assistant replied again');
  await shot('06-new-reply');

  check('L6', pageErrors.length === 0, `zero pageerror (${pageErrors.length})`);

  // final state dump
  const stF = await lvState();
  console.log('\n=== final state ===');
  console.log('recognizes:', JSON.stringify(stF.state.recognizes));
  console.log('engine starts/stops:', stF.state.engineStarts, '/', stF.state.engineStops);
  console.log('feeds:', JSON.stringify(stF.state.feeds));
  console.log('subs:', await subs());
  console.log('console msgs (last 15):', JSON.stringify(consoleMsgs.slice(-15), null, 1));
  writeFileSync('/tmp/lv-voice-loop-data.json', JSON.stringify({
    results, sessionId, recognizes: stF.state.recognizes, feeds: stF.state.feeds,
    engine: { starts: stF.state.engineStarts, stops: stF.state.engineStops },
    pageErrors, subs: JSON.parse(await subs()),
  }, null, 2));
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  await shot('99-error');
  process.exitCode = 1;
} finally {
  await browser.close();
}
const pass = results.filter(r => r.ok).length;
console.log(`\n===== ${pass}/${results.length} PASS =====`);
process.exit(results.every(r => r.ok) ? 0 : 1);
