#!/usr/bin/env node
/**
 * Tap interaction e2e — against the e2e instance (standalone entry).
 *
 * Locks down the interaction work of 261010:
 *   T1 declared HitAreas (haru: Head/Body): a tap on the avatar starts a
 *      Tap-group motion and publishes `dataset.lvTap` = "<area>:<group>";
 *      a tap on blank canvas changes nothing.
 *   T2 no HitAreas (tsumiki): the visible bounds decide — inside starts the
 *      motion ("body:<group>"), outside is ignored.
 *   T3 gesture coexistence: a 200px press-and-drag pans the model and must
 *      NOT fire a tap.
 *   T4 motion sounds: an idle motion must not fetch/play the model's own
 *      `sounds/*.wav` (hibiki ships voice clips with its idle motions).
 *   T5 idle cadence: models without an "Idle" group fall back to <=6s
 *      (megumin: 29 short clips in the unnamed group), models with one keep
 *      the user's interval (haru: 20s).
 *
 * Zero real API: POST /live2d-voice/session creates an empty session; no
 * message is ever sent, so no LLM/TTS/ASR call happens.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const LIB = '/root/.dsh/live2d-voice-models';
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); };

const BEFORE = CFG && existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pinModel = (name, extra = {}) => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, { modelPath: LIB, modelSelection: name, liveMode: 'first', eyeTracking: false, gyroParallax: false, ...extra });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

if (!PORT || !CFG) {
  console.log('… DSH_E2E_PORT/DSH_E2E_HOME not set — run via `dsh-e2e run`.');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 500 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const soundRequests = [];
page.on('request', (r) => { if (/\/sounds\/.*\.(wav|mp3|ogg|m4a)$/i.test(r.url())) soundRequests.push(r.url()); });

const newSession = (title) => fetch(`${ORIGIN}/live2d-voice/session`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }),
}).then((r) => r.json());

const loadModel = async (name, extra) => {
  pinModel(name, extra);
  const { sessionId } = await newSession(`tap-${name}`);
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
};

const canvasBox = () => page.evaluate(() => {
  const c = document.querySelector('.lv-stage canvas');
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const tapState = () => page.evaluate(() => ({
  tap: document.querySelector('.lv-stage')?.dataset?.lvTap ?? null,
  transform: document.querySelector('.lv-stage')?.dataset?.lvTransform ?? null,
  idle: document.querySelector('.lv-stage')?.dataset?.lvIdleInterval ?? null,
}));

/** Click and wait for `dataset.lvTap` to change (a motion may be playing at first). */
const tapAndWait = async (x, y, timeoutMs = 8000) => {
  const before = (await tapState()).tap;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
    const now = (await tapState()).tap;
    if (now && now !== before) return now;
  }
  return null;
};

try {
  // ── T1: declared HitAreas ────────────────────────────────────────────────
  await loadModel('haru', { idleInterval: 0 });
  const box = await canvasBox();
  const centerX = box.x + box.w / 2, centerY = box.y + box.h * 0.35;
  const tapped = await tapAndWait(centerX, centerY);
  check('T1a tap on haru (HitAreas) starts a Tap motion', Boolean(tapped) && /^(Head|Body):/.test(tapped), String(tapped));
  check('T1b published group is the Tap group', Boolean(tapped) && tapped.endsWith(':Tap'), String(tapped));

  const beforeBlank = await tapState();
  await page.mouse.click(box.x + 20, box.y + box.h - 20);
  await page.waitForTimeout(1200);
  const afterBlank = await tapState();
  check('T1c tap on blank canvas is ignored', afterBlank.tap === beforeBlank.tap, `${beforeBlank.tap} → ${afterBlank.tap}`);

  // ── T3: drag must not tap ────────────────────────────────────────────────
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(centerX + i * 20, centerY + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const afterDrag = await tapState();
  check('T3a drag does not fire a tap', afterDrag.tap === afterBlank.tap, `${afterBlank.tap} → ${afterDrag.tap}`);
  check('T3b drag still pans the model', afterDrag.transform !== afterBlank.transform, `${afterBlank.transform} → ${afterDrag.transform}`);

  // ── T2: no HitAreas → visible bounds ─────────────────────────────────────
  await loadModel('tsumiki', { idleInterval: 0 });
  const box2 = await canvasBox();
  const tapped2 = await tapAndWait(box2.x + box2.w / 2, box2.y + box2.h * 0.4);
  check('T2a tap inside bounds (no HitAreas) starts the motion', Boolean(tapped2) && tapped2.startsWith('body:'), String(tapped2));
  const beforeBlank2 = await tapState();
  await page.mouse.click(box2.x + 20, box2.y + box2.h - 20);
  await page.waitForTimeout(1200);
  check('T2b tap outside bounds is ignored', (await tapState()).tap === beforeBlank2.tap, String(beforeBlank2.tap));

  // ── T5: idle cadence contract ────────────────────────────────────────────
  await loadModel('megumin', { idleInterval: 20 });
  check('T5a no Idle group → cadence tightens to 6s', (await tapState()).idle === '6', String((await tapState()).idle));
  await loadModel('haru', { idleInterval: 20 });
  check('T5b Idle group → keeps the configured 20s', (await tapState()).idle === '20', String((await tapState()).idle));

  // ── T4: motion sounds are stripped ───────────────────────────────────────
  soundRequests.length = 0;
  await loadModel('hibiki', { idleInterval: 2 });
  await page.mouse.click(box2.x + 60, box2.y + 60); // user gesture so autoplay policy would allow audio
  await page.waitForTimeout(9000);
  check('T4 motion sounds never fetched (idle ran ≥3 cycles)', soundRequests.length === 0, soundRequests.slice(0, 3).join(' | '));

  check('T6 no page errors during the suite', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
