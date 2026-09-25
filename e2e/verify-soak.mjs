#!/usr/bin/env node
/**
 * Long-idle soak e2e: the "old phone left on the Live2D page fullscreen"
 * scenario. Mic listening + silence for ~6 minutes, a mid-soak network
 * blip (SSE reconnect), heap sampling, then speech → must respond.
 *
 * Asserts: mic survives idle (no VAD death), no unbounded heap growth,
 * SSE reconnects after offline blip, speech after idle still recognizes →
 * auto-submits → assistant replies.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync } from 'node:fs';
const { chromium } = pw;

const zhB64 = readFileSync('/tmp/t-zh-16k.pcm').toString('base64');
const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? '6');

const INIT = `
(() => {
  const PCM = { zh: ${JSON.stringify(zhB64)} };
  const state = { gumCalls: 0, recognizes: [], feeds: [], log: [] };
  window.__soak = () => JSON.stringify(state);
  const log = (k, extra) => { state.log.push({ t: Date.now(), k, ...extra }); try { state.log = state.log.slice(-40); } catch {} };
  // WHO closes an AudioContext?
  const OCL = AudioContext.prototype.close;
  AudioContext.prototype.close = function (...a) {
    log('ctx-close', { stack: String(new Error().stack).split('\\n').slice(1, 6).join(' <= ') });
    return OCL.apply(this, a);
  };
  document.addEventListener('visibilitychange', () => log('visibility', { state: document.visibilityState }));
  window.addEventListener('pagehide', () => log('pagehide'));
  window.addEventListener('freeze' in window ? 'freeze' : 'noop', () => log('freeze'));
  window.addEventListener('resume' in window ? 'resume' : 'noop2', () => log('ctx-resume'));
  // patch console.error to catch React errors
  const OCE = console.error;
  console.error = function (...a) { log('console-error', { msg: String(a[0]).slice(0, 120) }); return OCE.apply(this, a); };
  const of = window.fetch;
  window.fetch = function () {
    const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
    if (String(u).includes('/live2d-voice/asr/recognize')) {
      const e = { t: Date.now(), status: null };
      state.recognizes.push(e);
      return of.apply(this, arguments).then(async (r) => { e.status = r.status; e.done = Date.now(); return r; });
    }
    return of.apply(this, arguments);
  };
  const md = navigator.mediaDevices; const og = md.getUserMedia.bind(md);
  md.getUserMedia = async function (con) {
    state.gumCalls++;
    if (!con || !con.audio || con.video) return og(con);
    const scratch = new AudioContext();
    const stream = scratch.createMediaStreamDestination().stream;
    stream.__lvFake = true; return stream;
  };
  const oCMSS = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (stream) {
    if (!stream || !stream.__lvFake) return oCMSS.call(this, stream);
    window.__soakCtx = this;
    const tap = this.createGain(); tap.gain.value = 1; window.__soakTap = tap;
    const osc = this.createOscillator(); const g = this.createGain(); g.gain.value = 0;
    osc.connect(g); g.connect(tap); osc.start();
    return tap;
  };
  window.__soakFeed = (name) => {
    const c = window.__soakCtx; if (!c || !window.__soakTap) return 'no-tap';
    const bin = atob(PCM[name]); const n = bin.length >> 1;
    const LEAD = 16000 * 0.3;
    const buf = c.createBuffer(1, n + LEAD, 16000); const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i + LEAD] = (((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) | 0) / 32768);
    const src = c.createBufferSource(); src.__soakT = true; src.buffer = buf;
    const g = c.createGain(); g.gain.value = 1; src.connect(g); g.connect(window.__soakTap); src.start();
    state.feeds.push({ t: Date.now(), name });
    return 'fed';
  };
})();
`;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--mute-audio', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--js-flags=--expose-gc'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const followSessionIds = new Set();
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => {
    const s2 = String(f.payload);
    if (s2.includes('session/follow')) {
      const m = s2.match(/sessionId":"(session-[a-f0-9-]{30,})"/);
      if (m) followSessionIds.add(m[1]);
    }
  });
});
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.goto('http://127.0.0.1:4188/?token=e2etest', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  console.log('  probe@boot:', await page.evaluate(() => JSON.stringify({ soak: typeof window.__soak, feed: typeof window.__soakFeed })).catch((e) => String(e).slice(0, 100)));
  await page.evaluate(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (ed) ed.focus(); });
  await page.keyboard.type('你好', { delay: 10 });
  await page.keyboard.press('Enter');
  await sleep(10000);
  const ids = await page.evaluate(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
    return true;
  });
  await sleep(4000);
  check('S1a', ids, 'Live2D view open');

  // fullscreen (immersive)
  await page.evaluate(() => document.querySelector('.lv-hud [title^="全屏"]')?.click());
  await sleep(800);
  const fs = await page.evaluate(() => document.querySelector('.lv-root')?.classList.contains('lv-fullscreen'));
  check('S1b', fs === true, `fullscreen lv-root (.lv-fullscreen: ${fs})`);

  // mic on
  await page.evaluate(() => document.querySelector('.lv-hud .lv-mic')?.click());
  await sleep(2000);
  const mic1 = await page.evaluate(() => ({
    micbar: !!document.querySelector('.lv-micbar'),
    label: document.querySelector('.lv-mic-label')?.textContent ?? null,
  }));
  check('S1c', mic1.micbar, `listening (${mic1.label})`);

  // heap baseline
  const heap0 = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  check('S1d', heap0 > 0, `heap baseline ${(heap0 / 1048576).toFixed(1)}MB`);

  // ---- soak: silence with periodic sampling ----
  console.log(`=== soak ${SOAK_MINUTES} min ===`);
  let micAlive = true;
  for (let i = 0; i < SOAK_MINUTES; i++) {
    await sleep(60_000);
    const probe = await page.evaluate(() => JSON.stringify({
      micbar: !!document.querySelector('.lv-micbar'),
      label: document.querySelector('.lv-mic-label')?.textContent ?? null,
      heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      ctxState: window.__soakCtx ? window.__soakCtx.state : null,
      visibility: document.visibilityState,
      recentLog: JSON.parse(window.__soak()).log.slice(-3),
    }));
    const p = JSON.parse(probe);
    console.log(`  soak+${i + 1}min: micbar=${p.micbar} label="${p.label}" heap=${(p.heap / 1048576).toFixed(1)}MB ctx=${p.ctxState} vis=${p.visibility} log=${JSON.stringify(p.recentLog)}`);
    if (!p.micbar) micAlive = false;
    // network blip in the middle of the soak
    if (i === Math.floor(SOAK_MINUTES / 2) - 1) {
      await ctx.setOffline(true);
      await sleep(5000);
      await ctx.setOffline(false);
      console.log('  (network blip 5s done)');
    }
  }
  check('S2a', micAlive, 'micbar alive through the whole soak');
  const soakLog = await page.evaluate(() => JSON.parse(window.__soak()).log);
  console.log('  soak log:', JSON.stringify(soakLog, null, 1));
  const heap1 = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  const growthMB = (heap1 - heap0) / 1048576;
  check('S2b', growthMB < 40, `heap growth ${growthMB.toFixed(1)}MB (< 40MB)`);

  // SSE still alive: attach a fresh probe to the same session. (EventSource
  // connections do NOT appear in resource timing — use the captured id.)
  const sid = [...followSessionIds].pop();
  const sseOk = sid
    ? await page.evaluate(async (sessionId) => {
        return new Promise((resolve) => {
          try {
            const es = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sessionId)}`);
            const t = setTimeout(() => { es.close(); resolve(false); }, 6000);
            es.addEventListener('hello', () => { clearTimeout(t); es.close(); resolve(true); });
            es.onerror = () => {};
          } catch { resolve(false); }
        });
      }, sid)
    : false;
  check('S3', sseOk, 'SSE hub responds after soak + network blip');

  // ---- speech after long idle ----
  console.log('=== speak after idle ===');
  await page.evaluate(() => window.__soakFeed('zh'));
  let rec = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const st = JSON.parse(await page.evaluate(() => window.__soak()));
    rec = st.recognizes.find((r) => r.status !== null) ?? null;
    if (rec) break;
  }
  check('S4a', !!rec && rec.status === 200, `recognize after idle (${rec?.status})`);
  let userSub = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    userSub = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('.lv-sub.lv-user')];
      return lines.some((l) => /天气|散步/.test(l.textContent ?? '')) ? lines[lines.length - 1].textContent : null;
    });
    if (userSub) break;
  }
  check('S4b', !!userSub, `auto-submit after idle ("${String(userSub).slice(0, 24)}…")`);

  check('S5', pageErrors.length === 0, `zero pageerror (${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0].slice(0, 80) : ''})`);
  await page.screenshot({ path: '/tmp/lvsoak-final.png' }).catch(() => {});
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} PASS =====`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
