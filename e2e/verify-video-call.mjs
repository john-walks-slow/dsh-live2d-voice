#!/usr/bin/env node
/**
 * Video-call mode e2e: liveMode=call against the e2e instance (:4188).
 *
 * T1 config surface: /model reports liveMode=call + player entry.
 * T2 PiP stage: the player avatar renders on the single shared canvas
 *    inside the masked window; the DOM chrome (.lv-call-pip + name badge)
 *    sits at the default top-right spot with the fixture geometry.
 * T3 window vs stage gestures: dragging the stage never moves the framed
 *    avatar (lvPlayerTransform frozen at 0,0,1) while the AI still pans.
 * T4 direct input path: typed line → local echo subtitle, NO pending
 *    placeholder, NO player SSE events, assistant replies, raw text in
 *    the session log (no polish, no avatar re-speak).
 * T5 PiP drag + snap: pointer drag moves the window; release snaps it to
 *    the nearest corner (12px margin).
 * T6 mode switches via the ⚙ segment control: call → third (dual stage,
 *    no PiP chrome) → first (player avatar unmounted).
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const { chromium } = pw;

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const CFG = process.env.E2E_CFG ?? '/root/.dsh-e2e/live2d-voice.json';
const SESSIONS = process.env.E2E_SESSIONS ?? '/root/.dsh-e2e/sessions';
const PLAYER_MODEL = 'deepseek-chan';
const PLAYER_VOICE = 'ed3a1c523b524870a85a5a76cb1e0c3d'; // 元气少年音
const SHOT = (n) => `/tmp/lvvc-${n}.png`;
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

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
const shot = (n) => page.screenshot({ path: SHOT(n), timeout: 60000 }).catch(() => {});
const patchCfg = (patch) => {
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  Object.assign(cfg, patch);
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

/** The session's zstd log as text (newest session.v3 under the e2e home). */
const sessionLog = () => {
  const latest = execSync(`find ${SESSIONS} -name "session.v3.jsonl.zstd" -printf "%T@ %p\\n" | sort -rn | head -1 | cut -d' ' -f2-`).toString().trim();
  return execSync(`zstd -dc "${latest}"`).toString();
};

/** Dispatch a synthetic pointer drag directly on an element (bypasses the
 *  host anti-addiction overlay, like the third-person suite). */
const dragOn = (sel, fx, fy, dx, dy) => ev(([sel, fx, fy, dx, dy]) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const x0 = r.left + r.width * fx;
  const y0 = r.top + r.height * fy;
  const init = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 7, isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x0, clientY: y0 }));
  for (let i = 1; i <= 8; i++) {
    el.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x0 + (dx * i) / 8, clientY: y0 + (dy * i) / 8 }));
  }
  el.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x0 + dx, clientY: y0 + dy }));
  return true;
}, [sel, fx, fy, dx, dy]);

const pipRect = () => ev(() => {
  const pip = document.querySelector('.lv-call-pip');
  const stage = document.querySelector('.lv-stage');
  if (!pip || !stage) return null;
  const p = pip.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { left: p.left - s.left, top: p.top - s.top, w: p.width, h: p.height, sw: s.width, sh: s.height };
});

try {
  // baseline: call mode with the dual-model fixture.
  patchCfg({
    modelPath: '/root/.dsh-e2e-test-models',
    modelSelection: 'haru',
    liveMode: 'call',
    playerModelSelection: PLAYER_MODEL,
    playerVoiceId: PLAYER_VOICE,
    playerPolish: false,
    playerSpeechLanguage: 'zh',
  });
  { const cfg = JSON.parse(readFileSync(CFG, 'utf8')); delete cfg.workspaces; writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n'); }

  console.log('=== boot + session ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (!ed) return false; ed.focus(); return true; });
  await page.keyboard.type('你好，请用一句话自我介绍', { delay: 20 });
  await page.keyboard.press('Enter');
  await sleep(12000);
  const ids = [...followSessionIds];
  const sessionId = ids[ids.length - 1];
  check('T0a', !!sessionId, `session captured (${sessionId?.slice(0, 18)}…)`);

  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(4000);
  check('T0b', !!(await ev(() => document.querySelector('.lv-root'))), 'Live2D view mounted');

  // ---- T1: config surface ----
  console.log('=== T1 config surface ===');
  const modelInfo = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/model', { headers: { accept: 'application/json' } });
    return JSON.stringify(await r.json());
  }));
  check('T1a', modelInfo.liveMode === 'call', `/model liveMode=(${modelInfo.liveMode})`);
  check('T1b', modelInfo.player?.name === PLAYER_MODEL && typeof modelInfo.player?.url === 'string' && modelInfo.player.url.length > 0,
    `/model player entry (${modelInfo.player?.name ?? 'none'})`);

  // ---- T2: PiP stage ----
  console.log('=== T2 PiP stage ===');
  let pipData = '';
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    pipData = await ev(() => document.querySelector('.lv-call-pip')?.dataset.lvPip ?? '');
    if (pipData) break;
  }
  check('T2a', pipData === PLAYER_MODEL, `PiP chrome mounted (data-lv-pip="${pipData}")`);
  const canvasCount = await ev(() => document.querySelectorAll('.lv-stage canvas').length);
  check('T2b', canvasCount === 1, `single shared canvas (Cubism needs one WebGL context, ${canvasCount})`);
  const playerAttr = await ev(() => document.querySelector('.lv-stage')?.dataset.lvPlayer ?? '');
  check('T2c', playerAttr === PLAYER_MODEL, `player avatar mounted on shared stage (data-lv-player="${playerAttr}")`);
  check('T2d', !!(await ev(() => document.querySelector('.lv-call-pip-badge'))), 'PiP name badge rendered');
  const rect0 = await pipRect();
  const expW = rect0.sw * 0.26;
  check('T2e', !!rect0 && Math.abs(rect0.w - expW) < 12 && Math.abs(rect0.h - rect0.w / 0.75) < 12,
    `PiP geometry (w=${rect0?.w.toFixed(0)}/${expW.toFixed(0)}px, h=${rect0?.h.toFixed(0)})`);
  check('T2f', !!rect0 && Math.abs(rect0.left - rect0.sw * 0.71) < 16 && Math.abs(rect0.top - rect0.sh * 0.03) < 16,
    `default top-right position (left=${rect0?.left.toFixed(0)}, top=${rect0?.top.toFixed(0)})`);
  await shot('01-call-pip');

  // ---- T3: window vs stage gestures ----
  console.log('=== T3 window vs stage gestures ===');
  {
    const readTransform = () => ev(() => {
      const parse = (k) => {
        const [x = 0, y = 0, s = 0] = (document.querySelector('.lv-stage')?.dataset[k] ?? '').split(',').map(Number);
        return { x, y, s };
      };
      return { ai: parse('lvAiTransform'), pl: parse('lvPlayerTransform') };
    });
    const t0 = await readTransform();
    // Drag the empty stage center → the AI pans (single layout keeps its
    // gestures); the framed avatar must stay frozen.
    await dragOn('.lv-stage', 0.5, 0.55, 160, -32);
    await sleep(500);
    const t1 = await readTransform();
    check('T3a', Math.abs(t1.ai.x - t0.ai.x) >= 80, `stage drag pans the AI (ai ${t0.ai.x}→${t1.ai.x})`);
    check('T3b', t1.pl.x === 0 && t1.pl.y === 0 && Math.abs(t1.pl.s - 1) < 0.001,
      `framed avatar frozen (pl "${t1.pl.x},${t1.pl.y},${t1.pl.s}")`);
    // Drag right at the PiP window itself (stage-level handlers see the
    // player model hit) — still frozen.
    await dragOn('.lv-stage', 0.84, 0.2, 120, 40);
    await sleep(500);
    const t2 = await readTransform();
    check('T3c', t2.pl.x === 0 && t2.pl.y === 0 && Math.abs(t2.pl.s - 1) < 0.001,
      `drag inside the window stays frozen (pl "${t2.pl.x},${t2.pl.y},${t2.pl.s}")`);
    const rectAfter = await pipRect();
    check('T3d', !!rectAfter && Math.abs(rectAfter.left - rect0.left) < 4 && Math.abs(rectAfter.top - rect0.top) < 4,
      `stage gestures never move the window (left ${rect0.left.toFixed(0)}→${rectAfter?.left.toFixed(0)})`);
  }

  // ---- T4: direct input path ----
  console.log('=== T4 direct input path ===');
  await ev(() => document.querySelector('.lv-hud [title*="打字输入"]')?.click());
  await sleep(400);
  const RAW_LINE = '视频通话模式下这句话应该直接抵达角色';
  await ev(() => { const i = document.querySelector('.lv-input input'); if (i) { i.focus(); return true; } return false; });
  await page.keyboard.type(RAW_LINE, { delay: 15 });
  await ev((sid) => {
    window.__vc = [];
    window.__vces = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    for (const name of ['speech-start', 'audio-start', 'audio', 'subtitle', 'expression', 'speech-end', 'error']) {
      window.__vces.addEventListener(name, (raw) => {
        window.__vc.push({ name, data: JSON.parse(raw.data), t: Date.now() });
      });
    }
  }, sessionId);
  await sleep(600);
  await page.keyboard.press('Enter');

  let pendingSeen = false;
  let echoSeen = false;
  let asstSeen = false;
  let playerEvents = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    pendingSeen = pendingSeen || await ev(() => Boolean(document.querySelector('.lv-sub-pending')));
    echoSeen = echoSeen || await ev((prefix) => [...document.querySelectorAll('.lv-sub-card')].some((c) => c.textContent?.includes(prefix)), RAW_LINE.slice(0, 10));
    const list = JSON.parse(await ev(() => JSON.stringify(window.__vc)));
    playerEvents = Math.max(playerEvents, list.filter((e) => e.data?.speaker === 'player').length);
    asstSeen = asstSeen || list.some((e) => e.name === 'subtitle' && e.data.role === 'assistant' && (e.data.text ?? '').length >= 4)
      || list.some((e) => e.name === 'audio' && e.data.speaker === undefined && (e.data.b64 ?? '').length > 100);
    if (asstSeen) break;
  }
  check('T4a', !pendingSeen, 'no pending placeholder (no polish pipeline)');
  check('T4b', echoSeen, 'typed line echoed as the user subtitle');
  check('T4c', playerEvents === 0, `zero player SSE events (${playerEvents})`);
  check('T4d', asstSeen, 'assistant replies to the direct input');
  let log4 = '';
  for (let i = 0; i < 10; i++) { log4 = sessionLog(); if (log4.includes(RAW_LINE)) break; await sleep(1000); }
  check('T4e', log4.includes(RAW_LINE), 'session log records the raw line as the user message');
  await shot('02-direct-input');

  // ---- T5: PiP drag + corner snap ----
  console.log('=== T5 PiP drag + snap ===');
  {
    // Drag the window to the bottom-left area of the stage.
    const moved = await ev(() => {
      const pip = document.querySelector('.lv-call-pip');
      const stage = document.querySelector('.lv-stage');
      if (!pip || !stage) return false;
      const pr = pip.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const x0 = pr.left + pr.width * 0.5;
      const y0 = pr.top + pr.height * 0.5;
      const x1 = sr.left + sr.width * 0.12;
      const y1 = sr.top + sr.height * 0.92;
      const init = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 9, isPrimary: true };
      pip.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x0, clientY: y0 }));
      return true;
    });
    await sleep(300);
    const draggingClass = await ev(() => Boolean(document.querySelector('.lv-call-pip-dragging')));
    check('T5a', moved && draggingClass, 'drag start flags the dragging class');
    // Moves first, then a beat for React to commit pipPos (dispatched in the
    // same task as the pointerup, the release would read a stale ref).
    await ev(() => {
      const pip = document.querySelector('.lv-call-pip');
      const stage = document.querySelector('.lv-stage');
      const pr = pip.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const x0 = pr.left + pr.width * 0.5;
      const y0 = pr.top + pr.height * 0.5;
      const x1 = sr.left + sr.width * 0.12;
      const y1 = sr.top + sr.height * 0.92;
      const init = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 9, isPrimary: true };
      for (let i = 1; i <= 8; i++) {
        pip.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x0 + ((x1 - x0) * i) / 8, clientY: y0 + ((y1 - y0) * i) / 8 }));
      }
    });
    await sleep(300);
    const rectMid = await pipRect();
    check('T5b', !!rectMid && rectMid.left < rect0.left - rect0.sw * 0.3, `window follows the drag (left ${rect0.left.toFixed(0)}→${rectMid?.left.toFixed(0)})`);
    await ev(() => {
      const pip = document.querySelector('.lv-call-pip');
      const stage = document.querySelector('.lv-stage');
      const sr = stage.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, pointerId: 9, isPrimary: true };
      pip.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: sr.left + sr.width * 0.12, clientY: sr.top + sr.height * 0.92 }));
    });
    await sleep(600);
    const rect1 = await pipRect();
    // Bottom-left corner: left inset by the snap margin, top pinned to
    // (stage height − window height − margin). Band-based, not exact —
    // the snap transition and rounding move it a few px.
    check('T5c', !!rect1 && rect1.left < 25 && Math.abs(rect1.top - (rect1.sh - rect1.h - 12)) < 30,
      `snapped to bottom-left corner (left=${rect1?.left.toFixed(0)}, top=${rect1?.top.toFixed(0)}, sh-h-12=${rect1 ? (rect1.sh - rect1.h - 12).toFixed(0) : '?'})`);
    check('T5d', !(await ev(() => Boolean(document.querySelector('.lv-call-pip-dragging')))), 'dragging class cleared on release');
    await shot('03-pip-snapped');
  }

  // ---- T6: mode switches via the ⚙ segment control ----
  console.log('=== T6 mode switches ===');
  await ev(() => document.querySelector('.lv-hud [title*="快捷调整"]')?.click());
  await sleep(500);
  const segClick = async (label) => ev((label) => {
    const seg = [...document.querySelectorAll('.lv-pop .lv-mode-seg-btn')];
    const btn = seg.find((b) => b.textContent?.includes(label));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  check('T6a', await segClick('第三人称'), 'segment control carries 第三人称');
  let dual = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    dual = await ev(() => (document.querySelector('.lv-stage')?.dataset.lvPlayer ?? '') !== '' && !document.querySelector('.lv-call-pip'));
    if (dual) break;
  }
  check('T6b', dual, 'call → third: dual stage mounts, PiP chrome gone');
  await shot('04-third-regression');
  check('T6c', await segClick('第一人称'), 'segment control carries 第一人称');
  let solo = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    solo = await ev(() => (document.querySelector('.lv-stage')?.dataset.lvPlayer ?? '') === '' && !document.querySelector('.lv-call-pip'));
    if (solo) break;
  }
  check('T6d', solo, 'third → first: player avatar unmounted, no PiP chrome');
  const modelInfo6 = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/model', { headers: { accept: 'application/json' } });
    return JSON.stringify(await r.json());
  }));
  check('T6e', modelInfo6.liveMode === 'first' && !modelInfo6.player, `first → /model has no player entry (liveMode=${modelInfo6.liveMode})`);
  await shot('05-first-single');
  check('T7', pageErrors.length === 0, `zero pageerror (${pageErrors.length})`);
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  await shot('99-error');
  process.exitCode = 1;
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} PASS =====`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
