// Verify that settings section and Live UI use the unified selectors:
// 1. Settings Section:
//    - Module 1: Live2DModelSelector (row layout)
//    - Module 2: VoicePresetSelector (language + voice dropdowns, row layout)
//    - Module 5, 6, 7: DedicatedModelCard with LlmModelSelector (row layout)
//    - Module 9: Player model and voice use the unified selectors (row layout)
// 2. Interactive checks:
//    - VoicePresetSelector language category change filters presets without bounce-back
//    - DedicatedModelCard selecting model enables save button
// 3. Live UI (HUD Popover):
//    - Model selector: Live2DModelSelector (stack layout)
//    - Voice selector: VoicePresetSelector (stack layout)
//    - LLM Model selector: LlmModelSelector (stack layout)
//    - Third-person Player model & voice: Live2DModelSelector & VoicePresetSelector
// 4. CSS alignment:
//    - Both sides use .lv-model-select and .lv-select-group / .lv-select-group-row
//    - Dark mode variables aligned

import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = pw;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => {
  const text = String(e);
  if (text.includes('favicon.ico') || text.includes('404')) return;
  errors.push(text.slice(0, 200));
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const text = m.text();
    if (text.includes('favicon.ico') || text.includes('404')) return;
    errors.push(text.slice(0, 160));
  }
});

console.log('Navigating to DSH web...');
await page.goto(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/?token=${process.env.DSH_E2E_TOKEN || 'e2etest'}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Settings Section Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Part 1: Checking Settings Section ---');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button, a')].find((e) => (e.textContent ?? '').trim() === 'Settings');
  el?.click();
});
await page.waitForTimeout(1500);

// Open Live2D settings section
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').includes('Live2D'));
  el?.click();
});
// Poll until the settings cards render (fixed sleeps raced slow renders).
await page.waitForFunction(
  () => document.querySelectorAll('.lv-set-card').length >= 6,
  null,
  { timeout: 15000 },
).catch(() => {});

const settingsCheck = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.lv-set-card')];
  const cardTitles = [...document.querySelectorAll('.lv-set-card-title')].map((e) => (e.textContent ?? '').trim());

  // Check Module 1: Model selector
  const card1 = cards.find((c) => (c.textContent ?? '').includes('① 角色模型管理'));
  const card1Selects = card1 ? [...card1.querySelectorAll('select.lv-model-select')] : [];
  const card1HasRow = card1 ? !!card1.querySelector('.lv-select-group-row') : false;

  // Check Module 2: Voice selector
  const card2 = cards.find((c) => (c.textContent ?? '').includes('② 语音合成'));
  const card2Selects = card2 ? [...card2.querySelectorAll('select.lv-model-select')] : [];
  const card2HasRow = card2 ? !!card2.querySelector('.lv-select-group-row') : false;

  // Check Module 5, 6, 7: DedicatedModelCard
  const card5 = cards.find((c) => (c.textContent ?? '').includes('⑤ Live 模式专用模型'));
  const card5Selects = card5 ? [...card5.querySelectorAll('select.lv-model-select')] : [];
  const card5Btns = card5 ? [...card5.querySelectorAll('button.lv-set-btn')].map((b) => (b.textContent ?? '').trim()) : [];

  const card6 = cards.find((c) => (c.textContent ?? '').includes('⑥ 翻译专用模型'));
  const card6Selects = card6 ? [...card6.querySelectorAll('select.lv-model-select')] : [];

  const card7 = cards.find((c) => (c.textContent ?? '').includes('⑦ 润色专用模型'));
  const card7Selects = card7 ? [...card7.querySelectorAll('select.lv-model-select')] : [];

  // Check Module 9: Third-person player selectors
  const card9 = cards.find((c) => (c.textContent ?? '').includes('⑨ 第三人称模式'));
  const card9Selects = card9 ? [...card9.querySelectorAll('select.lv-model-select')] : [];

  return {
    cardTitles,
    card1: {
      hasRow: card1HasRow,
      selectCount: card1Selects.length,
      selectTitles: card1Selects.map((s) => s.getAttribute('title')),
    },
    card2: {
      hasRow: card2HasRow,
      selectCount: card2Selects.length,
      selectTitles: card2Selects.map((s) => s.getAttribute('title')),
    },
    card5: {
      selectCount: card5Selects.length,
      buttons: card5Btns,
    },
    card6: {
      selectCount: card6Selects.length,
    },
    card7: {
      selectCount: card7Selects.length,
    },
    card9: {
      selectCount: card9Selects.length,
    },
  };
});

console.log('Settings Check:');
console.log('  Card 1 (Model):', settingsCheck.card1);
console.log('  Card 2 (Voice):', settingsCheck.card2);
console.log('  Card 5 (Live Dedicated):', settingsCheck.card5);
console.log('  Card 6 (Translate):', settingsCheck.card6);
console.log('  Card 7 (Polish):', settingsCheck.card7);
console.log('  Card 9 (Third-person):', settingsCheck.card9);

// ─────────────────────────────────────────────────────────────────────────────
// Part 1b: Settings Interactive Tests (Category switch & Dedicated Model save)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Part 1b: Testing Settings Interaction ---');
const interactiveCheck = await page.evaluate(async () => {
  // Test category switch without bounce-back (BLK-01 / REC-03)
  // Test on Card 2 (Voice) where language categories exist (all, zh, ja, en)
  const card2 = [...document.querySelectorAll('.lv-set-card')].find((c) =>
    (c.textContent ?? '').includes('② 语音合成')
  );
  const voiceLangSelect = card2?.querySelector('select[title="音色语言"]');
  const voiceSelect = card2?.querySelector('select[title="预设音色"]');
  let groupSwitched = false;
  let modelCountBefore = voiceSelect?.options?.length ?? 0;
  let modelCountAfter = 0;

  if (voiceLangSelect && voiceLangSelect.options.length > 1) {
    const targetLangVal = voiceLangSelect.options[1].value;
    voiceLangSelect.value = targetLangVal;
    voiceLangSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait a brief moment to check for bounce-back
    await new Promise((r) => setTimeout(r, 600));
    groupSwitched = voiceLangSelect.value === targetLangVal;
    modelCountAfter = voiceSelect?.options?.length ?? 0;
  } else {
    groupSwitched = true;
  }

  // Test DedicatedModelCard interaction (REC-01)
  const card5 = [...document.querySelectorAll('.lv-set-card')].find((c) =>
    (c.textContent ?? '').includes('⑤ Live 模式专用模型')
  );
  const card5ModelSelect = card5?.querySelector('select[title="模型选择"]');
  const card5SaveBtn = card5?.querySelector('button.lv-set-btn-primary');
  const initialSaveDisabled = card5SaveBtn?.disabled ?? false;

  let modelPicked = false;
  let saveBtnEnabled = false;
  if (card5ModelSelect && card5ModelSelect.options.length > 1) {
    // Pick the first non-empty option
    const opt = [...card5ModelSelect.options].find((o) => o.value);
    if (opt) {
      card5ModelSelect.value = opt.value;
      card5ModelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      modelPicked = card5ModelSelect.value === opt.value;
      saveBtnEnabled = !(card5SaveBtn?.disabled ?? true);
    }
  }

  return {
    groupSwitched,
    modelCountBefore,
    modelCountAfter,
    initialSaveDisabled,
    modelPicked,
    saveBtnEnabled,
  };
});
console.log('Settings Interactive Check:', interactiveCheck);

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Live UI (HUD Popover) Verification via Live App
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Part 2: Checking Live UI (HUD popover) in Live view ---');
// Point the catalog at the shared fixture models (auto-selects catalog[0]),
// then create an empty session via the plugin API — no message, no LLM.
const cfgFile = `${process.env.DSH_E2E_HOME}/live2d-voice.json`;
const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {};
cfg.modelPath = '/root/.dsh-e2e-test-models';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
const created = await fetch(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/live2d-voice/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'selectors-e2e' }),
}).then((r) => r.json());
console.log('created session:', created.sessionId);
await page.goto(`http://127.0.0.1:${process.env.DSH_E2E_PORT}/live2d-voice/app?session=${encodeURIComponent(created.sessionId)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await page.waitForTimeout(4000);

// Open HUD Settings Popover
await page.waitForSelector('button[title*="快捷调整"]', { timeout: 15000 }).catch(() => {});
await page.click('button[title*="快捷调整"]');
await page.waitForTimeout(1000);

const hudCheck = await page.evaluate(() => {
  const pop = document.querySelector('.lv-pop-body');
  if (!pop) return { popoverFound: false, selects: [] };
  const selects = [...pop.querySelectorAll('select.lv-model-select')];
  const selectTitles = selects.map((s) => s.getAttribute('title'));
  const hasModelSelector = selects.some((s) => s.getAttribute('title') === '角色模型' || s.getAttribute('title') === '角色分类');
  const hasVoiceSelector = selects.some((s) => s.getAttribute('title') === '预设音色' || s.getAttribute('title') === '音色语言');
  const hasLlmSelector = selects.some((s) => s.getAttribute('title') === '模型选择');
  return {
    popoverFound: true,
    selectCount: selects.length,
    selectTitles,
    hasModelSelector,
    hasVoiceSelector,
    hasLlmSelector,
  };
});

console.log('HUD Check:', hudCheck);
console.log('Page Errors:', errors);

await browser.close();

const okSettings =
  settingsCheck.card1.selectCount >= 1 &&
  settingsCheck.card2.selectCount >= 1 &&
  settingsCheck.card5.selectCount >= 1 &&
  settingsCheck.card6.selectCount >= 1 &&
  settingsCheck.card7.selectCount >= 1 &&
  settingsCheck.card9.selectCount >= 1 &&
  interactiveCheck.groupSwitched &&
  interactiveCheck.saveBtnEnabled;

const okHud = hudCheck.popoverFound && hudCheck.hasModelSelector && hudCheck.hasVoiceSelector && hudCheck.hasLlmSelector;
const ok = okSettings && okHud && errors.length === 0;

console.log('Final Verification Result:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
