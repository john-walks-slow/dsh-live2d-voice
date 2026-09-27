#!/usr/bin/env node
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const url = process.env.E2E_URL ?? `http://127.0.0.1:${process.env.DSH_E2E_PORT}/?token=${process.env.DSH_E2E_TOKEN || 'e2etest'}`;
const zhB64 = readFileSync('/tmp/t-zh-16k.pcm').toString('base64');
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };
const INIT = `
(() => {
  window.__lvPatched = 'inject';
  const PCM = { zh: ${JSON.stringify(zhB64)} };
  const state = { gumCalls: 0, messages: [], feeds: [] };
  window.__lvState = () => JSON.stringify({ state });
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
const sleep = (ms) => page.waitForTimeout(ms);
const ev = (fn, ...args) => page.evaluate(fn, ...args);
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
const subs = () => ev(() => JSON.stringify([...document.querySelectorAll('.lv-sub-card, .lv-sub-old')].map((el) => ({ user: el.classList.contains('lv-sub-user'), text: el.textContent }))));
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (ed) { ed.focus(); return true; } return false; });
  await page.keyboard.type('你好', { delay: 30 });
  await page.keyboard.press('Enter');
  await sleep(20000);
  const sid = [...followSessionIds][[...followSessionIds].length - 1];
  check('I0a', !!sid, `session captured (${sid?.slice(0, 18)}…)`);
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(3500);
  check('I0b', await ev(() => !!document.querySelector('.lv-root')), 'GUI Live2D stage up');
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  await sleep(2500);
  await ev(() => window.__lvFeed());
  console.log('=== spoken; waiting for submit + reply ===');
  const findUser = async () => {
    const lines = JSON.parse(await subs());
    return lines.filter((l) => l.user && l.text.includes('公园'));
  };
  let userLines = [];
  for (let i = 0; i < 40 && userLines.length === 0; i++) { userLines = await findUser(); if (!userLines.length) await sleep(500); }
  check('I1a', userLines.length >= 1, `voice user subtitle seen (${userLines.length}) "${(userLines[0]?.text ?? '').slice(0, 30)}"`);
  // wait for assistant reply subtitle (up to 90s)
  let asst = null;
  for (let i = 0; i < 90 && !asst; i++) {
    const lines = JSON.parse(await subs());
    asst = lines.find((l) => !l.user && l.text && l.text.trim().length > 0);
    if (!asst) await sleep(1000);
  }
  check('I2a', !!asst, `assistant reply subtitle: ${asst ? `"${asst.text.slice(0, 50)}"` : 'none within 90s'}`);
  await sleep(3000);
  // ---- log check: the injection must be recorded as a user/message event ----
  const dir = `${process.env.DSH_E2E_HOME}/sessions`;
  const latest = execSync(`find ${dir} -name "session.v3.jsonl.zstd" -printf "%T@ %p\\n" | sort -rn | head -1 | cut -d' ' -f2-`).toString().trim();
  const log = execSync(`zstd -dc "${latest}"`).toString();
  const hits = log.split('\n').filter((l) => l.includes('dsh-live2d-voice'));
  const injectedTexts = hits.map((l) => { try { const evt = JSON.parse(l); return evt.data?.content?.[0]?.text ?? ''; } catch { return ''; } });
  check('I3a', hits.length >= 1, `user/message injection events: ${hits.length}`);
  check('I3b', injectedTexts.some((t) => t.includes('Live2D 语音模式')), 'injected text mentions Live2D 语音模式');
  check('I3c', injectedTexts.some((t) => t.includes('日语')), 'injected text mentions 日语 (speechLanguage=ja)');
  check('I3d', injectedTexts.some((t) => /\[(joy|neutral|sadness|sappiness)\]/u.test(t)), 'injected text lists [情绪] tags');
  console.log('--- injected sample ---');
  console.log((injectedTexts[0] ?? 'NONE').slice(0, 400));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
} finally {
  await browser.close();
}
