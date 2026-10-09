// Smoke test: open DSH system settings, confirm the Live2D translate/polish
// dedicated-model picker cards render (new ModelPickerCard instances).
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { skip } from './lib/skip.mjs';
const { chromium } = pw;

const E2E_URL = process.env.E2E_URL ?? `http://127.0.0.1:${process.env.DSH_E2E_PORT}/?token=${process.env.DSH_E2E_TOKEN || 'e2etest'}`;

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

await page.goto(E2E_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

// Click the "Settings" trigger button, then look for the Live2D card.
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button, a')].find((e) => (e.textContent ?? '').trim() === 'Settings');
  if (el) { el.click(); return true; }
  return false;
});
await page.waitForTimeout(1500);
// Open the "Live2D 角色与语音" settings nav cell directly.
const lvNav = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').includes('Live2D'));
  if (el) { el.click(); return true; }
  return false;
});
await page.waitForTimeout(3000);

// The Live2D settings card titles contain the module numbers.
const result = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.lv-set-card-title')].map((e) => (e.textContent ?? '').trim());
  const has = (needle) => cards.some((c) => c.includes(needle));
  return { cards, hasTranslate: has('翻译专用模型'), hasPolish: has('润色专用模型'), hasLive: has('Live 模式专用模型') };
});
if (result.cards.length === 0) {
  skip('verify-settings-model', '设置面板没渲染出 Live2D 设置卡（需要完整 GUI/设置导航状态；最小 e2e 实例达不到）');
}

/**
 * ADV-01 回归：触摸模式在 ⚙ 设置卡里也有入口（HUD 手指按钮之外的第二个入口）。
 * 这里做一次真实往返：改 select → 配置落盘 → 再改回去，证明这个入口不是装饰。
 */
const touchRoundTrip = async () => {
  const readConfig = () => page.evaluate(() => fetch('/live2d-voice/config').then((r) => r.json()).then((j) => j?.config?.touchMode));
  const field = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.lv-set-label')].find((l) => (l.textContent ?? '').includes('触摸模式'));
    const select = label?.parentElement?.querySelector('select');
    if (!select) return null;
    return { value: select.value, options: [...select.options].map((o) => o.value) };
  });
  if (!field) return { present: false };
  const before = await readConfig();
  const toggle = async (value) => {
    await page.evaluate((v) => {
      const label = [...document.querySelectorAll('.lv-set-label')].find((l) => (l.textContent ?? '').includes('触摸模式'));
      const select = label.parentElement.querySelector('select');
      select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(150);
      if ((await readConfig()) === (value === 'on')) break;
    }
    return readConfig();
  };
  const flipped = before === true ? 'off' : 'on';
  const afterFlip = await toggle(flipped);
  await toggle(before === true ? 'on' : 'off'); // 还原
  return { present: true, options: field.options, before, flipped, afterFlip };
};
result.touch = await touchRoundTrip();
console.log('settings clicked:', clicked, 'lv nav:', lvNav);

console.log('titles:', JSON.stringify(result.cards));
console.log('translate card:', result.hasTranslate ? '✓ renders' : '✗ MISSING');
console.log('polish card:', result.hasPolish ? '✓ renders' : '✗ MISSING');
console.log('live card (baseline):', result.hasLive ? '✓ renders' : '✗ MISSING');
console.log('page errors:', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none');
console.log('touchMode field:', JSON.stringify(result.touch));
const touchOk = Boolean(result.touch?.present) &&
  result.touch.options.includes('on') && result.touch.options.includes('off') &&
  result.touch.afterFlip === (result.touch.flipped === 'on');
console.log('touchMode 开关往返:', touchOk ? '✓ 设置卡入口可用且落盘' : '✗ 缺失或未落盘');

await browser.close();
process.exit(result.hasTranslate && result.hasPolish && touchOk && !errors.length ? 0 : 1);
