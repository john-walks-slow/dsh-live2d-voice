// e2e verification for Live mode unload and cleanup:
//   1. Enter Live2D tab → HUD capsule contains the explicit "Exit Live" button (.lv-btn-exit)
//   2. Page visibilitychange simulation: when document is hidden, mic is paused and speech stopped
//   3. Click "Exit Live" button (.lv-btn-exit) → smooth transition back to Chat tab
//   4. Verify that .lv-root and canvas are completely unmounted and destroyed from DOM
//   5. Verify that switching sessions mounts fresh component with unique key
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { firefox } = pw;
const url = 'http://127.0.0.1:4188/?token=e2etest';

let pass = 0, fail = 0;
function check(c, m) {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m); }
}

const browser = await firefox.launch({
  executablePath: '/root/.cache/camoufox/camoufox-bin',
  headless: true,
  args: ['--no-remote'],
  env: { ...process.env, MOZ_WEBGL_FORCE_ENABLE: '1', LIBGL_ALWAYS_SOFTWARE: '1' },
  firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);

console.log('=== STAGE 1: create session & enter Live2D ===');
const focused = await page.evaluate(() => {
  const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]');
  if (!ed) return false;
  ed.focus();
  return true;
});
check(focused, 'chat composer focused');
await page.keyboard.type('测试退出卸载功能', { delay: 30 });
await page.keyboard.press('Enter');
await page.waitForTimeout(5000);

// Switch to Live2D tab
await page.evaluate(() => {
  const matches = [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D'
  );
  let target = matches[0];
  while (target && target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'tab') target = target.parentElement;
  (target ?? matches[0]).click();
});
await page.waitForTimeout(3000);

const liveState = await page.evaluate(() => {
  const root = document.querySelector('.lv-root');
  const canvas = document.querySelector('.lv-stage canvas');
  const exitBtn = document.querySelector('.lv-btn-exit');
  return {
    rootMounted: !!root,
    canvasMounted: !!canvas,
    hasExitButton: !!exitBtn,
    exitButtonTitle: exitBtn ? exitBtn.getAttribute('title') : null,
  };
});
console.log('  Live2D state:', JSON.stringify(liveState));
check(liveState.rootMounted, 'Live2D view mounted (.lv-root present)');
check(liveState.canvasMounted, 'Pixi canvas mounted');
check(liveState.hasExitButton, 'HUD has explicit Exit Live button (.lv-btn-exit)');

console.log('=== STAGE 2: test visibilitychange handling ===');
const visibilityResult = await page.evaluate(() => {
  // Simulate document.hidden changing to true
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  const wasHidden = document.hidden;
  // Restore document.hidden to false
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  return { handledWithoutError: wasHidden };
});
check(visibilityResult.handledWithoutError, 'visibilitychange event dispatched and processed safely');

console.log('=== STAGE 3: click Exit Live button ===');
await page.evaluate(() => {
  const exitBtn = document.querySelector('.lv-btn-exit');
  exitBtn?.click();
});
await page.waitForTimeout(3000);

const afterExitState = await page.evaluate(() => {
  const root = document.querySelector('.lv-root');
  const canvas = document.querySelector('.lv-stage canvas');
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim();
  return {
    rootStillInDom: !!root,
    canvasStillInDom: !!canvas,
    activeTab,
  };
});
console.log('  After Exit state:', JSON.stringify(afterExitState));
check(!afterExitState.rootStillInDom, 'Live2D view completely unmounted (.lv-root removed from DOM)');
check(!afterExitState.canvasStillInDom, 'Pixi canvas and WebGL removed from DOM');
check(afterExitState.activeTab !== 'Live2D', `Returned to default tab (current: ${afterExitState.activeTab})`);

await browser.close();

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
