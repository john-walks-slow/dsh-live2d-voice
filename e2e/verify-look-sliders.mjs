#!/usr/bin/env node
/**
 * Look-parameter sliders e2e — against the e2e instance (:4188).
 *
 * T1 surface: 灵敏度 exposes the two source multipliers (+ 身体侧倾联动);
 *    动作幅度 exposes one amplitude per channel (转头 / 眼球 / 侧倾 / 位移),
 *    with no separate gain + max-range pair left.
 * T2 unsigned ranges: every slider starts at 0 (magnitudes only) and explains
 *    itself in a tooltip; angle amplitudes render in degrees.
 * T3 slider state: every amplitude is editable (single avatar, no gating).
 * T4 amplitude interaction: a changed value persists and renders back in its
 *    own unit.
 * T5 preset round-trip: 标准 restores the default amplitudes.
 * T6 no page errors; the e2e config is restored before exiting.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;

const url = process.env.E2E_URL ?? `http://127.0.0.1:${process.env.DSH_E2E_PORT}/?token=${process.env.DSH_E2E_TOKEN || 'e2etest'}`;
const STORE = 'lv-look-params-v5';
const LOOK_GROUPS = ['灵敏度', '动作幅度'];
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

  await stored(true); // clean slate: a previous run's params must not mask a regression

  check('T0b', await openLookPanel(), '⚙ popover + 详细参数 open');
  await sleep(800);
  let rows = await readSliders();
  check('T0c', rows.length === 7, `${rows.length}/7 look slider rows rendered`);

  console.log('=== T1 surface ===');
  const sens = rows.filter((r) => r.group === '灵敏度');
  const act = rows.filter((r) => r.group === '动作幅度');
  check('T1a', sens.length === 2, `灵敏度 rows = ${JSON.stringify(labelsOf(sens))}`);
  check('T1b', act.length === 5, `动作幅度 rows = ${JSON.stringify(labelsOf(act))}`);
  check('T1c', labelsOf(sens).join(',') === '摄像头灵敏度,陀螺仪灵敏度', '灵敏度 holds the two source multipliers only');
  check('T1d', labelsOf(act).join(',') === '转头幅度,眼球幅度,侧倾幅度,位移幅度,身体侧倾联动', '动作幅度 order 转头/眼球/侧倾/位移/身体联动');
  check('T1e', !rows.some((r) => /增益|整体幅度|最大/.test(r.label) || r.group === '整体幅度'), 'gain + max-range pair merged away');
  check('T1f', !rows.some((r) => r.group === '扩展可动性'), '扩展可动性 group merged into 灵敏度');

  console.log('=== T2 unsigned magnitude ranges ===');
  check('T2a', rows.every((r) => r.min === 0), `every slider is a magnitude starting at 0 (${rows.map((r) => r.min).join(',')})`);
  check('T2b', rows.every((r) => !r.signed), 'no slider carries the signed zero-notch class any more');
  check('T2c', rows.every((r) => r.tip.length > 0), 'every slider has a tooltip');
  check('T2d', pick(rows, '动作幅度', '转头幅度')?.shown === '20°' && pick(rows, '动作幅度', '侧倾幅度')?.shown === '6°',
    `angle amplitudes render in degrees (${pick(rows, '动作幅度', '转头幅度')?.shown} / ${pick(rows, '动作幅度', '侧倾幅度')?.shown})`);

  console.log('=== T3 slider state ===');
  check('T3a', rows.every((r) => !r.disabled), 'nothing disabled');
  await shot('01-panel');

  console.log('=== T4 amplitude interaction ===');
  check('T4c', rows.every((r) => !r.disabled), 'every slider is editable');
  const panBounds = await setRange('位移幅度', 0.012);
  await sleep(500);
  const rollBounds = await setRange('侧倾幅度', 9);
  await sleep(500);
  rows = await readSliders();
  const st = await stored();
  check('T4d', st.panAmp === 0.012, `panAmp persisted = ${st.panAmp}`);
  check('T4e', st.rollAmp === 9, `rollAmp persisted = ${st.rollAmp}`);
  check('T4f', pick(rows, '动作幅度', '侧倾幅度')?.shown === '9°', `roll amplitude renders in degrees (${pick(rows, '动作幅度', '侧倾幅度')?.shown})`);
  check('T4g', panBounds?.min === 0 && panBounds?.max === 0.05 && rollBounds?.min === 0 && rollBounds?.max === 20,
    `ranges: 位移 0..0.05 (${panBounds?.min}..${panBounds?.max}), 侧倾 0..20 (${rollBounds?.min}..${rollBounds?.max})`);
  const rollTip = pick(rows, '动作幅度', '侧倾幅度')?.tip ?? '';
  check('T4h', /AngleZ|侧倾/.test(rollTip), `roll tooltip names ParamAngleZ / 侧倾 (${rollTip})`);
  await shot('02-amplitudes');

  console.log('=== T5 preset round-trip ===');
  await clickPreset('标准');
  await sleep(600);
  const st2 = await stored();
  rows = await readSliders();
  check('T5a', st2.rollAmp === 6 && st2.panAmp === 0.005, `标准 preset restores roll & pan amplitudes (${st2.rollAmp}/${st2.panAmp})`);
  check('T5b', st2.angleAmp === 20 && st2.eyeAmp === 0.7 && st2.camSensitivity === 1 && st2.gyroSensitivity === 1, '标准 preset restores the default amplitudes');
  check('T5c', pick(rows, '动作幅度', '转头幅度')?.shown === '20°', `angle amplitude renders in degrees (${pick(rows, '动作幅度', '转头幅度')?.shown})`);

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
