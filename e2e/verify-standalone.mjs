#!/usr/bin/env node
/**
 * Standalone entry e2e: /live2d-voice/app?session=<id> — the chrome-less
 * Live2D page.
 *
 * S1  no session param → friendly guidance card, no crash
 * S2  valid session → stage mounts (canvas + HUD) without any GUI chrome
 * S3  keyboard submit → assistant reply arrives (SSE inside the standalone)
 * S4  cold-session submit → host cold-resumes the agent and replies
 * S5  voice loop: fake mic feed → recognize → auto-submit → reply
 * S6  zero pageerror
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, readdirSync } from 'node:fs';
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

try {
  // login (establish the auth cookie) then open the GUI once to create a session
  await page.goto('http://127.0.0.1:4188/?token=e2etest', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (ed) ed.focus(); });
  await page.keyboard.type('你好呀', { delay: 12 });
  await page.keyboard.press('Enter');
  await sleep(12000);
  const [warmSession] = [...followSessionIds].slice(-1);
  check('S0a', !!warmSession, `warm session captured (${warmSession?.slice(0, 18)}…)`);

  // ---- S1: no session param ----
  await page.goto('http://127.0.0.1:4188/live2d-voice/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3500);
  const s1 = await ev(() => ({
    guidance: document.body.textContent?.includes('缺少会话参数') ?? false,
    root: !!document.querySelector('.lv-root'),
  }));
  check('S1', s1.guidance && s1.root, `no-session guidance (${JSON.stringify(s1)})`);

  // ---- S2: valid session, standalone mounts ----
  await page.goto(`http://127.0.0.1:4188/live2d-voice/app?session=${encodeURIComponent(warmSession)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
  await ev(() => document.querySelector('.lv-hud [title*="键盘"]')?.click());
  await sleep(400);
  await page.keyboard.type('独立入口测试，请回一句收到', { delay: 12 });
  await page.keyboard.press('Enter');
  let reply = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    reply = await ev(() => {
      const lines = [...document.querySelectorAll('.lv-sub')].filter((el) => !el.classList.contains('lv-user') && !el.classList.contains('lv-err'));
      return lines.length ? lines[lines.length - 1].textContent : null;
    });
    if (reply && reply.length > 2) break;
  }
  check('S3', !!reply, `keyboard submit → reply ("${String(reply).slice(0, 24)}…")`);

  // ---- S4: cold session ----
  // pick a persisted session never opened in this GUI run (its agent is cold)
  let coldSession = null;
  for (const dir of readdirSync('/root/.dsh-e2e/sessions')) {
    try {
      const ids = readdirSync(`/root/.dsh-e2e/sessions/${dir}`);
      const candidate = ids.find((id) => id.startsWith('session-') && id !== warmSession && !followSessionIds.has(id));
      if (candidate) {
        const head = execSync(`zstd -dc /root/.dsh-e2e/sessions/${dir}/${candidate}/session.v3.jsonl.zstd 2>/dev/null | head -1`).toString();
        const cwd = JSON.parse(head).cwd;
        if (cwd) { coldSession = candidate; break; }
      }
    } catch {}
  }
  check('S4a', !!coldSession, `cold session found (${coldSession?.slice(0, 18)}…)`);
  if (coldSession) {
    await page.goto(`http://127.0.0.1:4188/live2d-voice/app?session=${encodeURIComponent(coldSession)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);
    const mounted = await ev(() => !!document.querySelector('.lv-stage canvas'));
    check('S4b', mounted, 'cold session standalone mounted');
    await ev(() => document.querySelector('.lv-hud [title*="键盘"]')?.click());
    await sleep(400);
    await page.keyboard.type('冷会话恢复测试', { delay: 12 });
    await page.keyboard.press('Enter');
    let coldReply = null;
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      const state = await ev(() => JSON.stringify({
        user: [...document.querySelectorAll('.lv-sub.lv-user')].length,
        any: [...document.querySelectorAll('.lv-sub')].filter((el) => !el.classList.contains('lv-err')).length,
        toast: document.querySelector('.lv-toast')?.textContent ?? null,
      }));
      const st = JSON.parse(state);
      if (i % 15 === 0) console.log(`  S4c+${i}s:`, state);
      if (st.any > 0) {
        coldReply = await ev(() => {
          const lines = [...document.querySelectorAll('.lv-sub')].filter((el) => !el.classList.contains('lv-user') && !el.classList.contains('lv-err'));
          return lines.length ? lines[lines.length - 1].textContent : null;
        });
        if (coldReply && coldReply.length > 2) break;
      }
    }
    check('S4c', !!coldReply, `cold-resume submit → reply ("${String(coldReply).slice(0, 24)}…")`);
  }

  // ---- S5: voice loop on the standalone page ----
  await ev(() => document.querySelector('.lv-hud .lv-mic')?.click());
  await sleep(2000);
  const micUp = await ev(() => !!document.querySelector('.lv-micbar'));
  check('S5a', micUp, 'mic listening on standalone');
  await ev(() => window.__saFeed('zh'));
  let rec = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const st = JSON.parse(await ev(() => window.__sa()));
    rec = st.recognizes.find((r) => r.status !== null) ?? null;
    if (rec) break;
  }
  check('S5b', !!rec && rec.status === 200, `recognize POST (${rec?.status})`);
  let voiceSub = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    voiceSub = await ev(() => [...document.querySelectorAll('.lv-sub.lv-user')].some((el) => /天气|散步/.test(el.textContent ?? '')));
    if (voiceSub) break;
  }
  check('S5c', !!voiceSub, 'voice auto-submit on standalone');

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
