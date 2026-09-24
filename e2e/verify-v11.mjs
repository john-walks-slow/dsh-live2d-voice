#!/usr/bin/env node
/**
 * v1.1.0 e2e: gaze asset routes, in-page MediaPipe pipeline load, and the
 * look_at_user camera tool full loop (fake video device).
 *
 * A  gaze routes: vision.mjs / wasm / model all 200 via the plugin proxy
 * B  in-page lazy load: dynamic import → FilesetResolver → FaceLandmarker
 *    (GPU, CPU fallback) actually constructs on the e2e instance
 * C  camera tool: model calls look_at_user → SSE camera-capture → page
 *    captures (fake camera) → POST camera-result → tool resolves → reply
 * D  UX spot checks: settings ✕ closes, fullscreen toggles
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--mute-audio', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const sleep = (ms) => page.waitForTimeout(ms);
const ev = (fn, ...args) => page.evaluate(fn, ...args);

try {
  await page.goto('http://127.0.0.1:4188/?token=e2etest', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  // COLD AGENT, VIEW-FIRST: open an existing session (history → Live2D tab
  // exists, agent cold after the instance restart), open the Live2D tab
  // BEFORE any prompt — the SSE is attached when the first prompt creates
  // the agent, exercising the agent/created registration path (B1).
  const opened = await ev(() => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')].filter((r) =>
      String(r.className).includes('sessionRow') && (r.textContent ?? '').trim() !== 'New Session');
    if (rows.length === 0) return false;
    rows[0].click();
    return true;
  });
  check('D0', opened, 'existing session opened');
  await sleep(3500);
  const tabFound = await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    if (matches.length === 0) return false;
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
    return true;
  });
  await sleep(4000);
  check('D1', tabFound && !!(await ev(() => document.querySelector('.lv-root'))), 'Live2D view mounted (cold agent, view-first)');

  // ---- A: gaze asset routes ----
  console.log('=== A gaze assets ===');
  const assets = await ev(async () => {
    const out = {};
    for (const [k, u] of Object.entries({ vision: '/live2d-voice/gaze/vision.mjs', wasm: '/live2d-voice/gaze/wasm/vision_wasm_internal.wasm', model: '/live2d-voice/gaze/model' })) {
      try {
        const r = await fetch(u);
        const blob = await r.blob();
        out[k] = { status: r.status, size: blob.size, type: blob.type };
      } catch (e) { out[k] = { status: 0, size: 0, error: String(e).slice(0, 60) }; }
    }
    return out;
  });
  check('A1', assets.vision.status === 200 && assets.vision.size > 100_000, `vision.mjs ${assets.vision.status} ${(assets.vision.size / 1024).toFixed(0)}KB`);
  check('A2', assets.wasm.status === 200 && assets.wasm.size > 1_000_000, `wasm ${assets.wasm.status} ${(assets.wasm.size / 1048576).toFixed(1)}MB`);
  check('A3', assets.model.status === 200 && assets.model.size > 1_000_000, `model ${assets.model.status} ${(assets.model.size / 1048576).toFixed(1)}MB`);

  // ---- B: in-page MediaPipe pipeline ----
  console.log('=== B mediapipe load ===');
  const mp = await ev(async () => {
    try {
      const vision = await import('/live2d-voice/gaze/vision.mjs');
      const fileset = await vision.FilesetResolver.forVisionTasks('/live2d-voice/gaze/wasm');
      if (!fileset) return { ok: false, stage: 'fileset' };
      const create = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/live2d-voice/gaze/model', delegate },
        runningMode: 'VIDEO', numFaces: 1,
      });
      let landmarker = null; let delegate = 'GPU';
      try { landmarker = await create('GPU'); } catch { delegate = 'CPU'; landmarker = await create('CPU'); }
      if (!landmarker) return { ok: false, stage: 'create' };
      landmarker.close?.();
      return { ok: true, delegate };
    } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
  });
  check('B1', mp.ok, `FaceLandmarker constructed (${JSON.stringify(mp)})`);

  // ---- C: camera tool loop ----
  console.log('=== C camera tool ===');
  await ev(() => {
    window.__cam = { captures: [], results: [] };
    const of = window.fetch;
    window.fetch = function () {
      const u = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
      if (String(u).includes('/live2d-voice/camera-result')) window.__cam.results.push({ t: Date.now() });
      return of.apply(this, arguments);
    };
  });
  // attach SSE probe to see camera-capture events
  const sessionId = await ev(() => {
    // the view's EventSource URL is not directly readable; find session id from the page URL-ish state
    return null;
  });
  // submit via the plugin message route using the live session: capture from websocket instead
  const followIds = [];
  await page.evaluate(() => {});
  // The keyboard submit CREATES the agent (cold session) — the fixed
  // agent/created + hub.has path must register the tool mid-turn.
  await ev(() => document.querySelector('.lv-hud [title*="键盘"]')?.click());
  await sleep(400);
  await page.keyboard.type('你好呀！请叫我一声', { delay: 12 });
  await page.keyboard.press('Enter');
  let firstReply = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    firstReply = await ev(() => {
      const lines = [...document.querySelectorAll('.lv-sub')].filter((el) => !el.classList.contains('lv-user') && !el.classList.contains('lv-err'));
      return lines.length ? lines[lines.length - 1].textContent : null;
    });
    if (firstReply) break;
  }
  console.log('  first turn reply:', JSON.stringify(firstReply));
  // The input stays open after the first submit — only open it if closed.
  await ev(() => { if (!document.querySelector('.lv-input')) document.querySelector('.lv-hud [title*="键盘"]')?.click(); });
  await sleep(400);
  await page.keyboard.type('现在用 look_at_user 工具看看我，然后告诉我你看到了什么', { delay: 12 });
  await page.keyboard.press('Enter');
  let captured = false;
  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    const cam = await ev(() => JSON.stringify(window.__cam));
    const c = JSON.parse(cam);
    if (c.captures.length > 0 || c.results.length > 0) { captured = true; break; }
  }
  // instrument: camera-capture SSE — poll for the toast instead
  let toastSeen = null;
  for (let i = 0; i < 8; i++) {
    toastSeen = await ev(() => document.querySelector('.lv-toast')?.textContent ?? null);
    if (toastSeen && toastSeen.includes('摄像头')) break;
    await sleep(1000);
  }
  const camState = JSON.parse(await ev(() => JSON.stringify(window.__cam)));
  check('C1', camState.results.length > 0, `camera-result POSTed (${camState.results.length})`);
  const subs2 = await ev(() => JSON.stringify([...document.querySelectorAll('.lv-sub')].map((el) => el.textContent)));
  console.log('  all subtitles:', subs2);
  // assistant reply after the tool call
  let reply = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    reply = await ev(() => {
      const lines = [...document.querySelectorAll('.lv-sub')].filter((el) => !el.classList.contains('lv-user') && !el.classList.contains('lv-err'));
      return lines.length > 0 ? lines[lines.length - 1].textContent : null;
    });
    if (reply && reply.length > 6) break;
  }
  check('C2', !!reply, `reply after tool call ("${String(reply).slice(0, 40)}…")`);

  // ---- D: UX spot checks ----
  console.log('=== D ux ===');
  await ev(() => document.querySelector('.lv-hud [title="语音设置"]')?.click());
  await sleep(400);
  const hadPanel = !!(await ev(() => document.querySelector('.lv-pop')));
  const closed = await ev(() => {
    document.querySelector('.lv-pop-close')?.click();
    return !!document.querySelector('.lv-pop-close');
  });
  await sleep(300);
  const popGone = !(await ev(() => document.querySelector('.lv-pop')));
  check('D2', hadPanel && closed && popGone, 'settings ✕ closes');
  await ev(() => document.querySelector('.lv-hud [title^="全屏"]')?.click());
  await sleep(800);
  const fs1 = await ev(() => document.fullscreenElement?.className ?? null);
  await ev(() => { if (document.fullscreenElement) document.exitFullscreen?.(); });
  await sleep(500);
  const fs2 = await ev(() => document.fullscreenElement?.className ?? null);
  check('D3', fs1 === 'lv-root' && fs2 === null, `fullscreen toggle (${fs1} → ${fs2 ?? 'null'})`);
  check('D4', pageErrors.length === 0, `zero pageerror (${pageErrors.length})`);
  await page.screenshot({ path: '/tmp/lvv11-final.png' }).catch(() => {});
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} PASS =====`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
