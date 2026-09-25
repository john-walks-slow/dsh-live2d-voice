#!/usr/bin/env node
/**
 * Lifelike gaze behavior e2e — against the e2e instance (:4188).
 *
 * T1 config surface: gazeMode/idleGaze present, defaults natural/true;
 *    POST patch round-trips both fields.
 * T2 behavior liveness: with the behavior ON (natural + idleGaze, no camera
 *    needed) the stage exposes dataset.lvGaze with a behavior state, and
 *    the state changes over time (the controller's wander/rest/scan cycle).
 * T3 master switch OFF: gazeMode=follow + idleGaze=false → dataset.lvGaze
 *    disappears entirely (legacy static behavior, no camera).
 * T4 HUD surface: the ⚙ popover shows the 自然行为 master switch and its
 *    aria-checked reflects the config; toggling it writes both config keys.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = pw;

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const CFG = process.env.E2E_CFG ?? '/root/.dsh-e2e/live2d-voice.json';
const SHOT = (n) => `/tmp/lvgaze-${n}.png`;
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
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: SHOT(n), timeout: 60000 }).catch(() => {});
const patchCfg = (patch) => {
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  Object.assign(cfg, patch);
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

/** Open the Live2D view: start a session first (the Live2D tab only exists
 * in an active conversation), then switch to it and wait for the stage. */
const openLiveView = async () => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (!ed) return false; ed.focus(); return true; });
  await page.keyboard.type('你好，请用一句话自我介绍', { delay: 10 });
  await page.keyboard.press('Enter');
  await sleep(10000);
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(5000);
  for (let i = 0; i < 60; i++) {
    if (await ev(() => !!document.querySelector('.lv-stage canvas'))) return true;
    // First entry after a session starts can be slow (model mount + warm-up);
    // re-click the tab once mid-poll in case the click landed pre-render.
    if (i === 15) {
      await ev(() => {
        const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
        let t = matches[0];
        while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
        t?.click();
      });
    }
    await sleep(1000);
  }
  return false;
};

try {
  // baseline: behavior fully ON (defaults), camera OFF (no eyeTracking).
  patchCfg({ gazeMode: 'natural', idleGaze: true, eyeTracking: false, gyroParallax: false });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  console.log('=== T1 config surface ===');
  const cfg1 = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/config', { headers: { accept: 'application/json' } });
    return JSON.stringify((await r.json()).config);
  }));
  check('T1a', cfg1.gazeMode === 'natural' && cfg1.idleGaze === true, `defaults gazeMode=${cfg1.gazeMode} idleGaze=${cfg1.idleGaze}`);
  const cfg2 = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gazeMode: 'follow', idleGaze: false }),
    });
    return JSON.stringify((await r.json()).config);
  }));
  check('T1b', cfg2.gazeMode === 'follow' && cfg2.idleGaze === false, `POST patch round-trip gazeMode=${cfg2.gazeMode} idleGaze=${cfg2.idleGaze}`);
  patchCfg({ gazeMode: 'natural', idleGaze: true }); // restore ON for T2

  console.log('=== T2 behavior liveness (ON) ===');
  const mounted = await openLiveView();
  check('T2a', mounted, 'Live2D stage mounted');
  let seen = new Set();
  let lvGaze = '';
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    lvGaze = await ev(() => document.querySelector('.lv-stage')?.dataset.lvGaze ?? '');
    if (lvGaze) seen.add(lvGaze);
    if (seen.size >= 3) break;
  }
  check('T2b', seen.size >= 2, `behavior states observed: ${[...seen].join(',')} (dataset.lvGaze)`);
  check('T2c', [...seen].every((s) => ['eye-contact', 'aversion', 'wander', 'scan', 'thinking', 'rest'].includes(s)), `states are valid behavior states`);
  await shot('01-behavior-on');

  console.log('=== T3 master switch OFF ===');
  patchCfg({ gazeMode: 'follow', idleGaze: false });
  // Config re-reads on mount — go back to chat and re-enter the Live view.
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && ['对话', 'Chat', 'Default'].includes(el.textContent?.trim() ?? ''));
    const t = matches.find((el) => el.closest('[role="tab"],button')) ?? matches[0];
    t?.closest('[role="tab"],button')?.click?.();
  });
  await sleep(2000);
  const mounted2 = await openLiveView();
  check('T3a', mounted2, 'stage re-mounted after master off');
  let lvGazeOff = '';
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    lvGazeOff = await ev(() => document.querySelector('.lv-stage')?.dataset.lvGaze ?? '');
    if (lvGazeOff) break;
  }
  check('T3b', lvGazeOff === '', `no behavior state when OFF (dataset.lvGaze="${lvGazeOff}")`);
  await shot('02-behavior-off');

  console.log('=== T4 HUD surface ===');
  patchCfg({ gazeMode: 'natural', idleGaze: true });
  // Re-enter to load natural config, then open the ⚙ popover.
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && ['对话', 'Chat', 'Default'].includes(el.textContent?.trim() ?? ''));
    const t = matches.find((el) => el.closest('[role="tab"],button')) ?? matches[0];
    t?.closest('[role="tab"],button')?.click?.();
  });
  await sleep(2000);
  await openLiveView();
  const gear = await ev(() => {
    const btn = document.querySelector('.lv-hud [title*="快捷调整"]');
    if (btn) btn.click();
    return !!btn;
  });
  await sleep(1200);
  const masterRow = await ev(() => {
    const rows = [...document.querySelectorAll('.lv-pop .lv-switch-row')];
    const row = rows.find((r) => r.textContent?.includes('自然行为'));
    return row ? { on: row.querySelector('button[role="switch"]')?.getAttribute('aria-checked'), text: row.textContent?.replace(/\s+/g, ' ').trim() } : null;
  });
  check('T4a', !!masterRow && masterRow.on === 'true', `HUD master switch present + on (${masterRow?.text ?? 'missing'})`);
  const afterToggle = await ev(async () => {
    const rows = [...document.querySelectorAll('.lv-pop .lv-switch-row')];
    const row = rows.find((r) => r.textContent?.includes('自然行为'));
    row?.querySelector('button[role="switch"]')?.click();
    await new Promise((r) => setTimeout(r, 800));
    const r2 = await fetch('/live2d-voice/config', { headers: { accept: 'application/json' } });
    const c = (await r2.json()).config;
    return { gazeMode: c.gazeMode, idleGaze: c.idleGaze };
  });
  check('T4b', afterToggle.gazeMode === 'follow' && afterToggle.idleGaze === false, `master toggle wrote both keys (gazeMode=${afterToggle.gazeMode} idleGaze=${afterToggle.idleGaze})`);
  patchCfg({ gazeMode: 'natural', idleGaze: true }); // restore

  // Browser/engine noise that is expected; everything else is a regression.
  const fatal = pageErrors.filter((m) => !/ResizeObserver|audio|MediaStream|Camera|WebGL|SecurityError|UNDICI/i.test(m));
  check('T9', fatal.length === 0, `no page errors (${fatal.length ? fatal.join(' | ') : 'clean'})`);

  console.log('\n=== summary ===');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.note}`);
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILED`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
} catch (err) {
  console.error('e2e crashed:', err);
  await shot('99-crash');
  await browser.close();
  process.exit(2);
}
