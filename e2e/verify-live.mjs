// e2e verification for dsh-live2d-voice on the 4188 instance:
//   1. GUI loads without page errors, plugin client bundle + Cubism Core live
//   2. Fresh session created via Chat composer (old v0 logs refuse resume —
//      the client-channel submit needs a v1 session)
//   3. Live2D tab opens → model renders (canvas)
//   4. Message submit via the Live2D keyboard input → GUI session channel →
//      SSE events (subtitle/expression/audio) + DOM subtitles
// NOTE: page.evaluate sees an Xray-wrapped window in this browser — content
// globals must be read through window.wrappedJSObject.
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
const { firefox } = pw;
const url = 'http://127.0.0.1:4188/?token=e2etest';

let pass = 0, fail = 0;
function check(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

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
const followSessionIds = new Set();
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('websocket', ws => {
  ws.on('framesent', f => {
    const s = String(f.payload);
    if (s.includes('session/follow')) {
      const m = s.match(/sessionId":"(session-[a-f0-9-]{30,})"/);
      if (m) followSessionIds.add(m[1]);
    }
  });
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(8000);
console.log('=== STAGE 1: boot ===');
check((await page.title()).length > 0, 'page title present');
check(pageErrors.length === 0, `no pageerror (${pageErrors.length})`);
check(consoleErrors.length === 0, `no console.error (${consoleErrors.length})`) || console.log('   console errors:', consoleErrors.slice(0, 5));

const env = await page.evaluate(() => {
  const content = window.wrappedJSObject ?? window;
  return {
    lvStyle: !!document.getElementById('dsh-live2d-voice-styles'),
    coreLoaded: typeof content.Live2DCubismCore === 'object',
    sessionRows: document.querySelectorAll('[role="treeitem"]').length,
    overlay: !!document.querySelector('[class*="anti-addiction"]'),
  };
});
console.log('  ' + JSON.stringify(env));
check(env.lvStyle, 'plugin client style tag injected (client bundle live)');
check(env.coreLoaded, 'Live2DCubismCore loaded in content realm (index injection works)');
check(!env.overlay, 'no anti-addiction overlay');

console.log('=== STAGE 2: create a fresh session via the Chat composer ===');
const focused = await page.evaluate(() => {
  const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]');
  if (!ed) return false;
  ed.focus();
  return true;
});
check(focused, 'chat composer focused');
await page.keyboard.type('你好', { delay: 30 });
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);
const afterFirst = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role="treeitem"]')].filter(el => /sessionRow/.test(String(el.className)));
  const lvTab = [...document.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D'
  );
  return {
    selected: rows.find(el => /selected/.test(String(el.className)))?.textContent?.slice(0, 40) ?? null,
    lvTab: !!lvTab,
  };
});
console.log('  ' + JSON.stringify(afterFirst));
check(afterFirst.selected && afterFirst.selected !== 'New Session', `fresh session created+selected (${afterFirst.selected})`);
check(afterFirst.lvTab, 'Live2D tab present after session creation');
await page.screenshot({ path: '/tmp/lv-e2e-1-chat.png' });

console.log('=== STAGE 3: switch to Live2D tab ===');
await page.evaluate(() => {
  const matches = [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D'
  );
  let target = matches[0];
  while (target && target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'tab') target = target.parentElement;
  (target ?? matches[0]).click();
});
await page.waitForTimeout(3500);
const stage = await page.evaluate(() => {
  const canvas = document.querySelector('.lv-stage canvas');
  return {
    root: !!document.querySelector('.lv-root'),
    canvas: !!canvas,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    hud: !!document.querySelector('.lv-hud'),
    buttons: [...document.querySelectorAll('.lv-hud .lv-btn')].map(b => b.title),
    statusCard: document.querySelector('.lv-card')?.textContent?.slice(0, 80) ?? null,
  };
});
console.log('  ' + JSON.stringify(stage));
check(stage.root, 'lv-root mounted');
check(stage.canvas, 'pixi canvas mounted (model rendered)');
check(stage.hud, 'HUD capsule present');
check(stage.buttons.length >= 5, `HUD has 5 buttons (${stage.buttons.length})`);
if (stage.statusCard) console.log('  ⚠ status card visible:', stage.statusCard);
await page.screenshot({ path: '/tmp/lv-e2e-2-model.png' });

console.log('=== STAGE 4: speak to the character ===');
// The current session's id: the last session/follow frame opened for it.
const sessionIds = [...followSessionIds];
console.log('  session ids seen in follow streams:', sessionIds.length);
const sessionId = sessionIds[sessionIds.length - 1];
check(!!sessionId, 'session id captured from follow stream');
if (sessionId) {
  await page.evaluate((sid) => {
    const content = window.wrappedJSObject ?? window;
    content.__lvEvents = [];
    const es = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    for (const name of ['speech-start', 'audio-start', 'audio', 'audio-end', 'speech-end', 'expression', 'subtitle', 'error']) {
      es.addEventListener(name, (raw) => content.__lvEvents.push({ name, data: JSON.parse(raw.data) }));
    }
  }, sessionId);
  await page.waitForTimeout(800);
}

const inputOpened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.lv-hud .lv-btn')].find(b => b.title?.includes('打字输入') || b.title?.includes('键盘'));
  if (!btn) return false;
  btn.click();
  return true;
});
await page.waitForTimeout(500);
check(inputOpened, 'keyboard input opened');
const typed = await page.evaluate(() => {
  const input = document.querySelector('.lv-input input');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '用一句话介绍你自己，并带上一个开心的表情。');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
check(typed, 'message typed');
await page.evaluate(() => document.querySelector('.lv-input button')?.click());
console.log('  message sent, waiting for reply…');
await page.screenshot({ path: '/tmp/lv-e2e-3-speaking.png' });

// Subtitles expire after 14s (SUBTITLE_TTL_MS) — poll and ACCUMULATE the
// lines seen: on a slow AI turn (TTFT > TTL) the user line can expire
// before the assistant line lands, so "both present at once" flakes.
let domState = { subs: [] };
const seenSubs = new Set();
for (let i = 0; i < 36; i++) {
  await page.waitForTimeout(2500);
  domState = await page.evaluate(() => {
    const subs = [...document.querySelectorAll('.lv-sub-card, .lv-sub-old')].map(el => el.textContent);
    return { subs };
  });
  for (const s of domState.subs) if (s && s.trim()) seenSubs.add(s.trim());
  const dbg = await page.evaluate(() => {
    const evs = window.__lvEvents ?? [];
    const subs = evs.filter(e => e.name === 'subtitle').map(e => `role=${e.data.role} aseq=${e.data.audioSeq}`);
    return { subs, audio: evs.filter(e => e.name === 'audio').length };
  });
  console.log('  poll', i + 1, `dom=${domState.subs.length} seen=${seenSubs.size} sseSubs=${dbg.subs.length} sseAudio=${dbg.audio}`);
  if (seenSubs.size >= 2) break;
}
// The reply may land after the window above (e2e-instance LLM TTFT can
// exceed 90s under load). Once its subtitle is on the SSE, the held line
// flushes as its audio plays — give that a few extra rounds.
for (let i = 0; i < 10 && seenSubs.size < 2; i++) {
  await page.waitForTimeout(2500);
  domState = await page.evaluate(() => {
    const subs = [...document.querySelectorAll('.lv-sub-card, .lv-sub-old')].map(el => el.textContent);
    return { subs };
  });
  for (const s of domState.subs) if (s && s.trim()) seenSubs.add(s.trim());
  if (seenSubs.size >= 2) break;
}
domState.subs = [...seenSubs];console.log('  DOM state:', JSON.stringify(domState));
await page.screenshot({ path: '/tmp/lv-e2e-4-reply.png' });

// Then wait for the full audio pipeline to drain (TTS chunks + audio-end).
await page.waitForTimeout(10000);
const result = await page.evaluate(() => {
  const content = window.wrappedJSObject ?? window;
  return { events: content.__lvEvents ?? null };
});
if (result.events) {
  const counts = {};
  for (const e of result.events) counts[e.name] = (counts[e.name] ?? 0) + 1;
  console.log('  SSE event counts:', JSON.stringify(counts));
  const firstAudio = result.events.find(e => e.name === 'audio');
  if (firstAudio) console.log('  first audio chunk b64 len:', firstAudio.data.b64.length, 'seq:', firstAudio.data.seq);
  const expr = result.events.find(e => e.name === 'expression');
  if (expr) console.log('  expression event:', JSON.stringify(expr.data));
  const errs = result.events.filter(e => e.name === 'error');
  if (errs.length) console.log('  ⚠ error events:', JSON.stringify(errs.slice(0, 3)));
  check(counts['speech-start'] >= 1, 'speech-start received');
  check(counts['audio-start'] >= 1, 'audio-start received');
  check(counts['audio'] >= 1, 'audio chunks received (TTS pipeline live)');
  check(counts['subtitle'] >= 1, 'subtitle events received');
  const asstSubs = (result.events ?? []).filter(e => e.name === 'subtitle' && e.data.role === 'assistant');
  check(asstSubs.length >= 1, `assistant subtitle events arrived (${asstSubs.length})`);
} else {
  check(false, 'no event probe (no session id seen)');
}
// The user line renders locally (no LLM dependency); the assistant DOM card
// depends on the reply's TTFT, which the e2e gateway can push past any
// sane window — its rendering is covered by verify-third-person's DOM
// assertions instead. Here we only hard-require the user line.
check(domState.subs.length >= 1, `DOM user subtitle rendered (seen ${domState.subs.length}: ${domState.subs.length >= 2 ? 'user+assistant' : 'user only'})`);
await page.screenshot({ path: '/tmp/lv-e2e-4-reply.png' });

console.log('=== errors ===');
console.log('  pageerror:', pageErrors.slice(0, 5));
console.log('  console.error:', consoleErrors.slice(0, 8));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail ? 1 : 0);
