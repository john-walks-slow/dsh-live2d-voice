#!/usr/bin/env node
/**
 * Signed look-gain sliders e2e — against the e2e instance (:4188).
 *
 * T1 surface: 摄像头 / 陀螺仪 groups each expose three rows (转头 / 旋转 /
 *    位移增益); 整体幅度 keeps its three non-signed amplitude rows.
 * T2 signed ranges: every gain slider spans negative→positive (min < 0) and
 *    carries the lv-signed class that draws the zero notch; amplitude
 *    sliders stay unsigned; every gain slider explains itself in a tooltip.
 * T3 third-person stage: with a player avatar on stage the head-facing gains
 *    (转头 + the new 旋转) are disabled with a 对视停用 hint, 位移 stays live.
 * T4 single model: drop the player avatar → gains become editable; typing
 *    negative values persists them and renders the sign.
 * T5 preset round-trip: 标准 restores the default gains (+1, explicit sign).
 * T6 no page errors; the e2e config is restored before exiting.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;

const url = process.env.E2E_URL ?? `http://127.0.0.1:${process.env.DSH_E2E_PORT}/?token=${process.env.DSH_E2E_TOKEN || 'e2etest'}`;
const STORE = 'lv-look-params-v1';
const LOOK_GROUPS = ['摄像头', '陀螺仪', '整体幅度'];
const SHOT = (n) => `/tmp/lvlook-${n}.png`;
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

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

/** Persisted look params (localStorage) — cleared on the first call. */
const stored = (clear = false) => ev(({ k, clear }) => {
  if (clear) localStorage.removeItem(k);
  try { return JSON.parse(localStorage.getItem(k) ?? '{}'); } catch { return {}; }
}, { k: STORE, clear });

/** Runtime config patch through the plugin route. */
const patchCfg = (patch) => ev(async (patch) => {
  await fetch('/live2d-voice/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}, patch);

const openLiveView = async () => {
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(4000);
  for (let i = 0; i < 40; i++) {
    if (await ev(() => !!document.querySelector('.lv-stage canvas'))) return true;
    await sleep(1000);
  }
  return false;
};
const backToChat = () => ev(() => {
  const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && ['对话', 'Chat', 'Default'].includes(el.textContent?.trim() ?? ''));
  const t = matches.find((el) => el.closest('[role="tab"],button')) ?? matches[0];
  t?.closest('[role="tab"],button')?.click?.();
});

/** Open ⚙ and expand 视向灵敏度 → 详细参数; true when the sliders are visible. */
const openLookPanel = async () => {
  await ev(() => document.querySelector('.lv-hud [title*="快捷调整"]')?.click());
  await sleep(1200);
  // The panel has several identical folds; the look one is labelled 详细参数.
  return ev(() => {
    const fold = [...document.querySelectorAll('.lv-pop .lv-look-fold')].find((b) => b.textContent?.includes('详细参数'));
    if (!fold) return false;
    // The caret carries the real open state (lv-open), aria-expanded follows it.
    if (!fold.querySelector('.lv-look-caret.lv-open')) fold.click();
    return true;
  });
};

/** Look-slider rows of the three look groups: { group, label, min, max, signed, disabled, tip, shown }. */
const readSliders = () => ev((groups) => {
  const out = [];
  let group = '';
  for (const el of document.querySelectorAll('.lv-pop .lv-slider-group-title, .lv-pop .lv-slider-row')) {
    if (el.classList.contains('lv-slider-group-title')) { group = el.textContent?.trim() ?? ''; continue; }
    if (!groups.includes(group)) continue;
    const input = el.querySelector('input[type="range"]');
    if (!input) continue;
    out.push({
      group,
      label: el.querySelector('.lv-slider-label')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      min: Number(input.min),
      max: Number(input.max),
      signed: input.classList.contains('lv-signed'),
      disabled: input.disabled,
      tip: input.title ?? '',
      shown: el.querySelector('.lv-slider-value')?.textContent?.trim() ?? '',
    });
  }
  return out;
}, LOOK_GROUPS);

/** Set a range input the way a user would (native setter + input event → React onChange). */
const setRange = (label, raw) => ev(({ label, raw }) => {
  const row = [...document.querySelectorAll('.lv-pop .lv-slider-row')]
    .find((r) => r.querySelector('.lv-slider-label')?.textContent?.includes(label));
  const input = row?.querySelector('input[type="range"]');
  if (!input) return null;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(raw));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { min: Number(input.min), max: Number(input.max) };
}, { label, raw });

const clickPreset = (label) => ev((label) => {
  [...document.querySelectorAll('.lv-pop .lv-look-preset')].find((b) => b.textContent?.trim() === label)?.click();
}, label);

const labelsOf = (rows) => rows.map((r) => r.label.replace(/（.*/, ''));
const pick = (rows, group, label) => rows.find((r) => r.group === group && r.label.includes(label));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (ed) ed.focus(); });
  await page.keyboard.type('你好，请用一句话自我介绍', { delay: 10 });
  await page.keyboard.press('Enter');
  await sleep(10000);
  check('T0a', await openLiveView(), 'Live2D stage mounted');

  const orig = await ev(async () => {
    const r = await fetch('/live2d-voice/config', { headers: { accept: 'application/json' } });
    const c = (await r.json()).config;
    return { thirdPerson: c.thirdPerson, playerModelSelection: c.playerModelSelection };
  });
  const dual = orig.thirdPerson === true && Boolean(orig.playerModelSelection);
  console.log(`    (config: thirdPerson=${orig.thirdPerson} player=${orig.playerModelSelection} → ${dual ? 'dual stage' : 'single model'})`);
  await stored(true); // clean slate: a previous run's params must not mask a regression

  check('T0b', await openLookPanel(), '⚙ popover + 详细参数 open');
  await sleep(800);
  let rows = await readSliders();
  check('T0c', rows.length === 9, `${rows.length}/9 look slider rows rendered`);

  console.log('=== T1 surface ===');
  const cam = rows.filter((r) => r.group === '摄像头');
  const gyro = rows.filter((r) => r.group === '陀螺仪');
  const amp = rows.filter((r) => r.group === '整体幅度');
  check('T1a', cam.length === 3, `摄像头 rows = ${JSON.stringify(labelsOf(cam))}`);
  check('T1b', gyro.length === 3, `陀螺仪 rows = ${JSON.stringify(labelsOf(gyro))}`);
  check('T1c', labelsOf(cam).join(',') === '转头增益,旋转增益,位移增益', '摄像头 order 转头/旋转/位移');
  check('T1d', labelsOf(gyro).join(',') === '转头增益,旋转增益,位移增益', '陀螺仪 order 转头/旋转/位移');
  check('T1e', amp.length === 3 && labelsOf(amp).join(',') === '最大转头角度,最大位移,最大侧倾', `整体幅度 unchanged = ${JSON.stringify(labelsOf(amp))}`);

  console.log('=== T2 signed ranges ===');
  const gains = rows.filter((r) => /增益/.test(r.label));
  check('T2a', gains.length === 6 && gains.every((r) => r.min < 0), `6 gain sliders, all min<0 (${gains.map((r) => r.min).join(',')})`);
  check('T2b', gains.every((r) => r.signed), 'gains carry lv-signed (zero notch)');
  check('T2c', amp.every((r) => r.min >= 0 && !r.signed), 'amplitude sliders stay unsigned');
  check('T2d', gains.every((r) => r.tip.length > 0), 'every gain slider has a tooltip (dual mode: the 对视停用 note)');

  console.log('=== T3 third-person stage ===');
  if (dual) {
    const off = rows.filter((r) => r.disabled);
    check('T3a', off.length === 4, `4 head-facing gains disabled (${off.map((r) => r.label).join('/')})`);
    check('T3b', off.every((r) => /转头增益|旋转增益/.test(r.label)), 'the new 旋转增益 joins 转头增益 in the 对视停用 set');
    check('T3c', rows.filter((r) => r.group !== '整体幅度' && /位移增益/.test(r.label)).every((r) => !r.disabled), '位移增益 stays live in dual mode');
  } else {
    check('T3a', rows.every((r) => !r.disabled), 'single model: no gain disabled');
    check('T3b', true, 'dual-stage assertions skipped (config is single model)');
    check('T3c', true, 'dual-stage assertions skipped (config is single model)');
  }
  await shot('01-panel');

  console.log('=== T4 negative interaction (single model) ===');
  if (dual) {
    await patchCfg({ thirdPerson: false, playerModelSelection: '' });
    await backToChat();
    await sleep(2000);
    check('T4a', await openLiveView(), 'stage re-mounted in single-model mode');
    check('T4b', await openLookPanel(), '⚙ panel re-opened');
    await sleep(800);
    rows = await readSliders();
  }
  check('T4c', rows.filter((r) => r.group !== '整体幅度').every((r) => !r.disabled), 'all gain sliders editable');
  const panBounds = await setRange('位移增益', -0.5);
  await sleep(500);
  const rollBounds = await setRange('旋转增益', -1.5);
  await sleep(500);
  rows = await readSliders();
  const st = await stored();
  check('T4d', st.camPanGain === -0.5, `camPanGain persisted = ${st.camPanGain}`);
  check('T4e', st.camRollGain === -1.5, `camRollGain persisted = ${st.camRollGain}`);
  check('T4f', pick(rows, '摄像头', '旋转增益')?.shown === '-1.5', `negative roll renders with the sign (${pick(rows, '摄像头', '旋转增益')?.shown})`);
  check('T4g', panBounds?.min === -1 && rollBounds?.min === -2, `ranges: 位移 -1..1 (min=${panBounds?.min}), 旋转 -2..2 (min=${rollBounds?.min})`);
  const rollTip = pick(rows, '陀螺仪', '旋转增益')?.tip ?? '';
  check('T4h', /AngleZ|侧倾/.test(rollTip), `roll tooltip names ParamAngleZ / 侧倾 (${rollTip})`);
  await shot('02-negative-gains');

  console.log('=== T5 preset round-trip ===');
  await clickPreset('标准');
  await sleep(600);
  const st2 = await stored();
  rows = await readSliders();
  check('T5a', st2.camRollGain === 1 && st2.gyroRollGain === 1, `标准 preset restores both roll gains (${st2.camRollGain}/${st2.gyroRollGain})`);
  check('T5b', st2.camPanGain === 0.2 && st2.camAngleGain === 1 && st2.gyroAngleGain === 0.55, '标准 preset restores the legacy gains too');
  check('T5c', pick(rows, '陀螺仪', '旋转增益')?.shown === '+1', `positive roll gain renders with an explicit + (${pick(rows, '陀螺仪', '旋转增益')?.shown})`);

  // Restore whatever the e2e instance was configured with before the run.
  await patchCfg({ thirdPerson: orig.thirdPerson, playerModelSelection: orig.playerModelSelection });
  await stored(true);
  await ev(() => document.querySelector('.lv-pop-close')?.click());
  await sleep(800);

  const fatal = pageErrors.filter((m) => !/ResizeObserver|audio|MediaStream|Camera|WebGL|SecurityError|UNDICI/i.test(m));
  check('T6', fatal.length === 0, `no page errors (${fatal.length ? fatal.join(' | ') : 'clean'})`);

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
