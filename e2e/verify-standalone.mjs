#!/usr/bin/env node
/**
 * Standalone entry e2e: /live2d-voice/app?session=<id> — the chrome-less
 * Live2D page.
 *
 * S0  session via the plugin route (铁律 #3: never a message-for-id)
 * S1  no session param → friendly guidance card, no crash
 * S2  valid session → stage mounts (canvas + HUD) without any GUI chrome
 * S3  keyboard submit → assistant reply arrives (SSE inside the standalone)
 * S4  cold-session submit → host cold-resumes the agent and replies
 * S5  voice loop: fake mic feed → recognize → auto-submit → reply
 *     (S5b/c need REAL ASR — asrMode=buffered + volc credentials in the
 *     e2e home; they SKIP with a notice in the zero-API home)
 * S6  zero pageerror
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const { chromium } = pw;

const zhB64 = readFileSync('/tmp/t-zh-16k.pcm').toString('base64');
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

const INIT = `
(() => {
  const PCM = { zh: ${JSON.stringify(zhB64)} };
  const state = { recognizes: [], feeds: [] };
  window.__sa = () => JSON.stringify(state);
  const of = window.fetch;
  window.fetch = function () {
    const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
    if (String(u).includes('/live2d-voice/asr/recognize')) {
      const e = { t: Date.now(), status: null };
      state.recognizes.push(e);
      return of.apply(this, arguments).then((r) => { e.status = r.status; return r; });
    }
    return of.apply(this, arguments);
  };
  const md = navigator.mediaDevices; const og = md.getUserMedia.bind(md);
  md.getUserMedia = async function (con) {
    if (!con || !con.audio || con.video) return og(con);
    const scratch = new AudioContext();
    const stream = scratch.createMediaStreamDestination().stream;
    stream.__lvFake = true; return stream;
  };
  const oCMSS = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (stream) {
    if (!stream || !stream.__lvFake) return oCMSS.call(this, stream);
    window.__saCtx = this;
    const tap = this.createGain(); tap.gain.value = 1; window.__saTap = tap;
    const osc = this.createOscillator(); const g = this.createGain(); g.gain.value = 0;
    osc.connect(g); g.connect(tap); osc.start();
    return tap;
  };
  window.__saFeed = (name) => {
    const c = window.__saCtx; if (!c || !window.__saTap) return 'no-tap';
    const bin = atob(PCM[name]); const n = bin.length >> 1;
    const LEAD = 16000 * 0.3;
    const buf = c.createBuffer(1, n + LEAD, 16000); const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i + LEAD] = (((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) | 0) / 32768);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = 1; src.connect(g); g.connect(window.__saTap); src.start();
    state.feeds.push({ t: Date.now(), name });
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = (ms) => page.waitForTimeout(ms);

try {
  // Pin first-person mode: this suite asserts the direct-input path — a
  // leftover liveMode=third/call from another suite would reroute the
  // submit through the player pipeline.
  {
    const cfgPath = `${process.env.DSH_E2E_HOME}/live2d-voice.json`;
    const c = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (c.liveMode !== 'first') {
      c.liveMode = 'first';
      writeFileSync(cfgPath, JSON.stringify(c, null, 2) + '\n');
    }
  }
  // ---- S0: session via the plugin route (铁律 #3: no message-for-id, no
  // GUI composer dance — the standalone page is opened directly below). ----
  const created = await fetch(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/live2d-voice/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'standalone-e2e' }),
  }).then((r) => r.json());
  const warmSession = created.sessionId;
  check('S0a', !!warmSession, `session created (${warmSession?.slice(0, 18)}…)`);

  // ---- S1: no session param ----
  await page.goto(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/live2d-voice/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3500);
  const s1 = await ev(() => ({
    guidance: document.body.textContent?.includes('缺少会话参数') ?? false,
    root: !!document.querySelector('.lv-root'),
  }));
  check('S1', s1.guidance && s1.root, `no-session guidance (${JSON.stringify(s1)})`);

  // ---- S2: valid session, standalone mounts ----
  await page.goto(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/live2d-voice/app?session=${encodeURIComponent(warmSession)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(6000);
  const s2 = await ev(() => ({
    canvas: !!document.querySelector('.lv-stage canvas'),
    hud: !!document.querySelector('.lv-hud'),
    guiChrome: !!document.querySelector('[contenteditable="true"][aria-label*="Describe"]'),
    sidebar: document.body.textContent?.includes('Workspaces') ?? false,
  }));
  check('S2a', s2.canvas && s2.hud, `stage + HUD mounted (canvas=${s2.canvas}, hud=${s2.hud})`);
  check('S2b', !s2.guiChrome && !s2.sidebar, `no GUI chrome (composer=${s2.guiChrome}, sidebar=${s2.sidebar})`);
  await page.screenshot({ path: '/tmp/lvsa-standalone.png' }).catch(() => {});

  // ---- S3: keyboard submit → reply over SSE ----
  await ev(() => document.querySelector('.lv-hud [title*="打字输入"]')?.click());
  await sleep(400);
  await ev(() => { const i = document.querySelector('.lv-input input'); if (i) { i.focus(); return true; } return false; });
  await page.keyboard.type('独立入口测试，请回一句收到', { delay: 12 });
  // SSE probe (installed before Enter) — a DOM subtitle poll cannot tell
  // the assistant card from the TTS-error card (error cards carry no
  // class marker), and in this keyless home the error card lands last.
  await ev((sid) => {
    window.__sub = [];
    window.__subes = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    window.__subes.addEventListener('subtitle', (raw) => {
      const d = JSON.parse(raw.data);
      if (d.role === 'assistant' && (d.text ?? '').length > 2) window.__sub.push(d);
    });
  }, warmSession);
  await sleep(400);
  await page.keyboard.press('Enter');
  let reply = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const got = await ev(() => JSON.stringify(window.__sub));
    reply = JSON.parse(got)[0]?.text ?? null;
    if (reply) break;
  }
  check('S3', !!reply, `keyboard submit → reply over SSE ("${String(reply).slice(0, 24)}…")`);

  // ---- S4: cold session ----
  // pick a persisted session never opened in this GUI run (its agent is cold)
  let coldSession = null;
  for (const dir of readdirSync(`${process.env.DSH_E2E_HOME}/sessions`)) {
    try {
      const ids = readdirSync(`${process.env.DSH_E2E_HOME}/sessions/${dir}`);
      const candidate = ids.find((id) => id.startsWith('session-') && id !== warmSession);
      if (candidate) {
        const head = execSync(`zstd -dc ${process.env.DSH_E2E_HOME}/sessions/${dir}/${candidate}/session.v3.jsonl.zstd 2>/dev/null | head -1`).toString();
        const cwd = JSON.parse(head).cwd;
        if (cwd) { coldSession = candidate; break; }
      }
    } catch {}
  }
  check('S4a', !!coldSession, `cold session found (${coldSession?.slice(0, 18)}…)`);
  if (coldSession) {
    await page.goto(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/live2d-voice/app?session=${encodeURIComponent(coldSession)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);
    const mounted = await ev(() => !!document.querySelector('.lv-stage canvas'));
    check('S4b', mounted, 'cold session standalone mounted');
    await ev(() => document.querySelector('.lv-hud [title*="打字输入"]')?.click());
    await sleep(400);
    await ev(() => { const i = document.querySelector('.lv-input input'); if (i) { i.focus(); return true; } return false; });
    await page.keyboard.type('冷会话恢复测试', { delay: 12 });
    // SSE probe (same rationale as S3 — assistant reply, not the error card).
    await ev((sid) => {
      window.__sub = [];
      window.__subes = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
      window.__subes.addEventListener('subtitle', (raw) => {
        const d = JSON.parse(raw.data);
        if (d.role === 'assistant' && (d.text ?? '').length > 2) window.__sub.push(d);
      });
    }, coldSession);
    await sleep(400);
    await page.keyboard.press('Enter');
    let coldReply = null;
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      const got = await ev(() => JSON.stringify(window.__sub));
      coldReply = JSON.parse(got)[0]?.text ?? null;
      if (coldReply) break;
    }
    check('S4c', !!coldReply, `cold-resume submit → reply over SSE ("${String(coldReply).slice(0, 24)}…")`);
  }

  // ---- S5: voice loop on the standalone page ----
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  await sleep(2000);
  const micUp = await ev(() => !!document.querySelector('.lv-micbar'));
  check('S5a', micUp, 'mic listening on standalone');
  // The recognize round needs REAL ASR (buffered mode + volc credentials
  // in the e2e home) — skipped with a notice in the zero-API home.
  const asrReady = (() => {
    try {
      const c = JSON.parse(readFileSync(`${process.env.DSH_E2E_HOME}/live2d-voice.json`, 'utf8'));
      const cred = typeof c.asrCredentialsFile === 'string' && c.asrCredentialsFile
        ? c.asrCredentialsFile
        : `${process.env.DSH_E2E_HOME}/.config/volc-asr/credentials.json`;
      return c.asrMode === 'buffered' && existsSync(cred);
    } catch { return false; }
  })();
  if (!asrReady) {
    console.log('↷ S5b/S5c SKIP voice round needs real ASR (asrMode=buffered + credentials) — not configured in this home');
  } else {
    await ev(() => window.__saFeed('zh'));
    let rec = null;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const st = JSON.parse(await ev(() => window.__sa()));
      rec = st.recognizes.find((r) => r.status !== null) ?? null;
      if (rec) break;
    }
    check('S5b', !!rec && rec.status === 200, `recognize POST (${rec?.status})`);
    let voiceSub = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      voiceSub = await ev(() => [...document.querySelectorAll('.lv-sub-card.lv-sub-user')].some((el) => /天气|散步/.test(el.textContent ?? '')));
      if (voiceSub) break;
    }
    check('S5c', !!voiceSub, 'voice auto-submit on standalone');
  }

  check('S6', pageErrors.length === 0, `zero pageerror (${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0].slice(0, 80) : ''})`);
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} PASS =====`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
