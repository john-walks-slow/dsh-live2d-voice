import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { chromium } = pw;

const E2E_URL = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const BASE = new URL(E2E_URL).origin;
const TOKEN = new URL(E2E_URL).searchParams.get('token') ?? 'e2etest';

function check(label, cond, detail = '') {
  if (cond) {
    console.log(`✓ ${label} ${detail}`);
  } else {
    console.error(`✗ ${label} FAILED ${detail}`);
    process.exitCode = 1;
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
  });
  const page = await context.newPage();

  // 1. Open session
  await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')].filter((r) =>
      String(r.className).includes('sessionRow') && (r.textContent ?? '').trim() !== 'New Session');
    if (rows.length > 0) rows[0].click();
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"]')];
    const live = tabs.find((t) => (t.textContent ?? '').includes('Live2D'));
    if (live) live.click();
  });
  await page.waitForSelector('.lv-root', { timeout: 15000 });
  check('T1', true, 'Live2D mounted');

  // Check initial state
  const initFixed = await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    return window.getComputedStyle(root).position;
  });
  check('T2', initFixed === 'absolute', `Initial position is absolute (${initFixed})`);

  // 2. Click keyboard button
  await page.evaluate(() => {
    const btn = document.querySelector('.lv-hud button[title*="键盘"], .lv-hud button[title*="打字"]');
    btn?.click();
  });
  await page.waitForTimeout(400);

  const kbState = await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    const cs = window.getComputedStyle(root);
    return {
      hasKb: root.classList.contains('lv-keyboard-open'),
      hasFs: root.classList.contains('lv-fullscreen'),
      pos: cs.position,
      zIndex: cs.zIndex,
    };
  });
  check('T3', kbState.hasKb && !kbState.hasFs, `Keyboard open without fullscreen (.lv-fullscreen=${kbState.hasFs})`);
  check('T4', kbState.pos === 'absolute', `Keyboard open stays position:absolute (not fixed, pos=${kbState.pos})`);

  // Close keyboard
  await page.evaluate(() => {
    const btn = document.querySelector('.lv-hud button[title*="收起键盘"], .lv-hud button[title*="键盘"], .lv-hud button[title*="打字"]');
    btn?.click();
  });
  await page.waitForTimeout(300);

  // 3. Click fullscreen button -> should enter immersive web-app fullscreen
  await page.evaluate(() => {
    const btn = document.querySelector('.lv-hud button[title*="全屏"]');
    btn?.click();
  });
  await page.waitForTimeout(400);

  const fsState = await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    const cs = window.getComputedStyle(root);
    return {
      hasFs: root.classList.contains('lv-fullscreen'),
      pos: cs.position,
      zIndex: cs.zIndex,
    };
  });
  check('T5', fsState.hasFs && fsState.pos === 'fixed' && fsState.zIndex === '2147483000', `Fullscreen button activates .lv-fullscreen with position:fixed (z-index=${fsState.zIndex})`);

  // 4. Press Escape to exit fullscreen
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const escState = await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    return {
      hasFs: root.classList.contains('lv-fullscreen'),
      pos: window.getComputedStyle(root).position,
    };
  });
  check('T6', !escState.hasFs && escState.pos === 'absolute', `Escape key exits fullscreen (.lv-fullscreen=${escState.hasFs}, pos=${escState.pos})`);

  // 5. Test keyboard on-screen height shrink: avatar scale & position invariance
  // Open keyboard again
  await page.evaluate(() => {
    const btn = document.querySelector('.lv-hud button[title*="键盘"], .lv-hud button[title*="打字"]');
    btn?.click();
  });
  await page.waitForTimeout(400);

  const beforeShrink = await page.evaluate(() => {
    const stage = document.querySelector('.lv-stage');
    return {
      transform: stage?.getAttribute('data-lv-transform'),
      height: stage?.clientHeight,
    };
  });

  // Simulate on-screen keyboard shrinking the viewport / container height
  await page.evaluate(() => {
    const root = document.querySelector('.lv-root');
    if (root) {
      root.style.height = '400px'; // Shrunk by keyboard
      window.dispatchEvent(new Event('resize'));
    }
  });
  await page.waitForTimeout(400);

  const afterShrink = await page.evaluate(() => {
    const stage = document.querySelector('.lv-stage');
    return {
      transform: stage?.getAttribute('data-lv-transform'),
      height: stage?.clientHeight,
    };
  });

  check('T7', beforeShrink.transform === afterShrink.transform,
    `Avatar transform unchanged when keyboard shrinks viewport (before=${beforeShrink.transform}, after=${afterShrink.transform})`);

  await browser.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
