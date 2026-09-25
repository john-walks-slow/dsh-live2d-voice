// Smoke test: open DSH system settings, confirm the Live2D translate/polish
// dedicated-model picker cards render (new ModelPickerCard instances).
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;

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

await page.goto('http://127.0.0.1:4188/?token=e2etest', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
console.log('settings clicked:', clicked, 'lv nav:', lvNav);

console.log('titles:', JSON.stringify(result.cards));
console.log('translate card:', result.hasTranslate ? '✓ renders' : '✗ MISSING');
console.log('polish card:', result.hasPolish ? '✓ renders' : '✗ MISSING');
console.log('live card (baseline):', result.hasLive ? '✓ renders' : '✗ MISSING');
console.log('page errors:', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none');

await browser.close();
process.exit(result.hasTranslate && result.hasPolish && !errors.length ? 0 : 1);
