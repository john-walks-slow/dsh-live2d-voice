#!/usr/bin/env node
/**
 * Third-person mode e2e: the player-avatar speech pipeline, dual-model
 * stage, polish routing, and the off-fallback — against the e2e instance
 * (:4188).
 *
 * T1 config surface: /model reports thirdPerson + player entry; settings
 *    ⚙ popover shows the 第三人称 block (model/voice/polish controls).
 * T2 dual stage: two canvases render (AI stage + player overlay).
 * T3 polish-off UI round trip: typed line → pending placeholder
 *    ("酝酿中…") → player subtitle (你 badge, raw text, speaker:player SSE)
 *    → player audio → assistant reply; player chunks strictly precede
 *    assistant chunks (wire ordering = the whole design).
 * T4 session log: the submitted user message equals the player's spoken
 *    line (what the avatar said is what the AI hears).
 * T5 polish-on (playerSpeechLanguage=ja): Chinese input → Japanese player
 *    line (kana) + player expression event; session log holds the
 *    polished line, not the raw input.
 * T6 off-fallback: thirdPerson=false → /player-line submits raw text with
 *    no player SSE; ⚙ toggle drops the second canvas.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const { chromium } = pw;

const url = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const CFG = process.env.E2E_CFG ?? '/root/.dsh-e2e/live2d-voice.json';
const PLAYER_MODEL = 'deepseek-chan';
const PLAYER_VOICE = 'ed3a1c523b524870a85a5a76cb1e0c3d'; // 元气少年音
const SHOT = (n) => `/tmp/lvtp-${n}.png`;
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };
const KANA = /[ぁ-ゖァ-ヺー]/u;

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
const followSessionIds = new Set();
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => {
    const s = String(f.payload);
    if (s.includes('session/follow')) {
      const m = s.match(/sessionId":"(session-[a-f0-9-]{30,})"/);
      if (m) followSessionIds.add(m[1]);
    }
  });
});
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: SHOT(n), timeout: 60000 }).catch(() => {});
const patchCfg = (patch) => {
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  Object.assign(cfg, patch);
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

/** The session's zstd log as text (newest session.v3 under /root/.dsh-e2e). */
const sessionLog = () => {
  const latest = execSync(`find /root/.dsh-e2e/sessions -name "session.v3.jsonl.zstd" -printf "%T@ %p\\n" | sort -rn | head -1 | cut -d' ' -f2-`).toString().trim();
  return execSync(`zstd -dc "${latest}"`).toString();
};

try {
  // baseline: dual model fixture, third-person ON, polish OFF.
  patchCfg({
    modelPath: '/root/.dsh-e2e-test-models',
    modelSelection: 'haru',
    thirdPerson: true,
    playerModelSelection: PLAYER_MODEL,
    playerVoiceId: PLAYER_VOICE,
    playerPolish: false,
    playerSpeechLanguage: 'zh',
  });
  { const cfg = JSON.parse(readFileSync(CFG, 'utf8')); delete cfg.workspaces; writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n'); }

  console.log('=== boot + session ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (!ed) return false; ed.focus(); return true; });
  await page.keyboard.type('你好，请用一句话自我介绍', { delay: 20 });
  await page.keyboard.press('Enter');
  await sleep(12000);
  const ids = [...followSessionIds];
  const sessionId = ids[ids.length - 1];
  check('T0a', !!sessionId, `session captured (${sessionId?.slice(0, 18)}…)`);

  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(4000);
  check('T0b', !!(await ev(() => document.querySelector('.lv-root'))), 'Live2D view mounted');

  // ---- T1: config surface ----
  console.log('=== T1 config surface ===');
  const modelInfo = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/model', { headers: { accept: 'application/json' } });
    return JSON.stringify(await r.json());
  }));
  check('T1a', modelInfo.thirdPerson === true, `/model thirdPerson=(${modelInfo.thirdPerson})`);
  check('T1b', modelInfo.player?.name === PLAYER_MODEL && typeof modelInfo.player?.url === 'string' && modelInfo.player.url.length > 0,
    `/model player entry (${modelInfo.player?.name ?? 'none'})`);
  const cfgView = JSON.parse(await ev(async (sid) => {
    const r = await fetch(`/live2d-voice/config?session=${encodeURIComponent(sid)}`, { headers: { accept: 'application/json' } });
    return JSON.stringify((await r.json()).config);
  }, sessionId));
  check('T1c', cfgView.thirdPerson === true && cfgView.playerPolish === false && cfgView.playerVoiceId === PLAYER_VOICE,
    `config surface (thirdPerson=${cfgView.thirdPerson} polish=${cfgView.playerPolish})`);

  // ---- T2: dual stage ----
  console.log('=== T2 dual stage ===');
  let playerAttr = '';
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    playerAttr = await ev(() => document.querySelector('.lv-stage')?.dataset.lvPlayer ?? '');
    if (playerAttr) break;
  }
  const canvasCount = await ev(() => document.querySelectorAll('.lv-stage canvas').length);
  check('T2a', playerAttr === PLAYER_MODEL, `player avatar mounted on shared stage (data-lv-player="${playerAttr}")`);
  check('T2b', canvasCount === 1, `single shared canvas (Cubism needs one WebGL context, ${canvasCount})`);
  await shot('01-dual-stage');

  // ---- T3: polish-off UI round trip ----
  console.log('=== T3 polish-off round trip ===');
  await ev(() => document.querySelector('.lv-hud [title*="打字输入"]')?.click());
  await sleep(400);
  const RAW_LINE = '今天好累啊，随便回应我一句就好';
  await ev(() => { const i = document.querySelector('.lv-input input'); if (i) { i.focus(); return true; } return false; });
  await page.keyboard.type(RAW_LINE, { delay: 15 });
  // install SSE probe first (before Enter)
  await ev((sid) => {
    window.__tp = [];
    window.__tpes = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    for (const name of ['speech-start', 'audio-start', 'audio', 'subtitle', 'expression', 'speech-end', 'error']) {
      window.__tpes.addEventListener(name, (raw) => {
        window.__tp.push({ name, data: JSON.parse(raw.data), t: Date.now() });
      });
    }
  }, sessionId);
  await sleep(600);
  await page.keyboard.press('Enter');

  // pending placeholder appears immediately after acceptance
  let pendingSeen = false;
  for (let i = 0; i < 12; i++) {
    pendingSeen = await ev(() => Boolean(document.querySelector('.lv-sub-pending')));
    if (pendingSeen) break;
    await sleep(250);
  }
  check('T3a', pendingSeen, 'pending placeholder ("酝酿中…") shown after submit');

  // player subtitle via SSE (raw text — polish off)
  let playerSub = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const list = JSON.parse(await ev(() => JSON.stringify(window.__tp)));
    playerSub = list.find((e) => e.name === 'subtitle' && e.data.role === 'user' && e.data.speaker === 'player') ?? playerSub;
    if (playerSub) break;
  }
  check('T3b', !!playerSub, `player subtitle over SSE (${playerSub ? `"${String(playerSub.data.text).slice(0, 20)}…"` : 'none'})`);
  check('T3c', playerSub?.data?.text === RAW_LINE, 'polish off → player speaks the raw line');
  // placeholder retired, 你 badge rendered
  let badge = false;
  for (let i = 0; i < 10; i++) {
    badge = await ev(() => {
      if (document.querySelector('.lv-sub-pending')) return false;
      const cur = document.querySelector('.lv-sub-card .lv-sub-speaker');
      return Boolean(cur && cur.textContent === '你');
    });
    if (badge) break;
    await sleep(1000);
  }
  check('T3d', badge, 'placeholder replaced + "你" speaker badge rendered');

  // player audio + ordering vs assistant
  let playerAudio = null, assistantAudio = null, lastPlayerIdx = -1, firstAssistantIdx = -1, asstSub = null, playerStart = null, playerEnd = null;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const list = JSON.parse(await ev(() => JSON.stringify(window.__tp)));
    playerStart = list.find((e) => e.name === 'speech-start' && e.data.speaker === 'player') ?? playerStart;
    playerEnd = list.find((e) => e.name === 'speech-end' && e.data.speaker === 'player' && e.data.reason === 'finish') ?? playerEnd;
    playerAudio = list.find((e) => e.name === 'audio' && e.data.speaker === 'player' && (e.data.b64 ?? '').length > 100) ?? playerAudio;
    lastPlayerIdx = Math.max(lastPlayerIdx, ...list.map((e, idx) => (e.name === 'audio' && e.data.speaker === 'player' ? idx : -1)));
    const fa = list.findIndex((e) => e.name === 'audio' && e.data.speaker === undefined);
    firstAssistantIdx = fa >= 0 ? fa : firstAssistantIdx;
    assistantAudio = list.find((e) => e.name === 'audio' && e.data.speaker === undefined && (e.data.b64 ?? '').length > 100) ?? assistantAudio;
    asstSub = list.find((e) => e.name === 'subtitle' && e.data.role === 'assistant' && (e.data.text ?? '').length >= 4) ?? asstSub;
    if (playerAudio && assistantAudio && asstSub && playerEnd) break;
  }
  check('T3e', !!playerStart && !!playerAudio && !!playerEnd, `player speech events (${playerStart ? 'start' : '-'}${playerAudio ? '+audio' : ''}${playerEnd ? '+end' : ''})`);
  check('T3f', !!asstSub, `assistant reply subtitle (${asstSub ? `"${String(asstSub.data.text).slice(0, 20)}…"` : 'none'})`);
  check('T3g', lastPlayerIdx >= 0 && firstAssistantIdx >= 0 && lastPlayerIdx < firstAssistantIdx,
    `wire ordering: last player chunk #${lastPlayerIdx} < first assistant chunk #${firstAssistantIdx}`);
  await shot('02-player-then-reply');

  // ---- T4: session log ----
  console.log('=== T4 session log ===');
  let log4 = '';
  for (let i = 0; i < 10; i++) { log4 = sessionLog(); if (log4.includes(RAW_LINE)) break; await sleep(1000); }
  check('T4a', log4.includes(RAW_LINE), 'session log records the player line as the user message');
  await sleep(2000);

  // ---- T5: polish on (playerSpeechLanguage=ja) ----
  console.log('=== T5 polish on (zh input → ja line) ===');
  patchCfg({ playerPolish: true, playerSpeechLanguage: 'ja' });
  await sleep(800);
  await ev(() => { window.__tp = []; });
  const RAW5 = '我真的累坏了，今天加班到现在，安慰我一下吧';
  const sent5 = await ev(async ([sid, text]) => {
    const r = await fetch('/live2d-voice/player-line', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, text }),
    });
    return r.status;
  }, [sessionId, RAW5]);
  check('T5a', sent5 === 200, `player-line accepted (${sent5})`);
  let sub5 = null, expr5 = null, audio5 = null;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const list = JSON.parse(await ev(() => JSON.stringify(window.__tp)));
    sub5 = list.find((e) => e.name === 'subtitle' && e.data.speaker === 'player' && (e.data.text ?? '').length >= 2) ?? sub5;
    expr5 = list.find((e) => e.name === 'expression' && e.data.speaker === 'player') ?? expr5;
    audio5 = list.find((e) => e.name === 'audio' && e.data.speaker === 'player' && (e.data.b64 ?? '').length > 100) ?? audio5;
    if (sub5 && audio5) break;
  }
  check('T5b', !!sub5, `polished player subtitle (${sub5 ? `"${String(sub5.data.text).slice(0, 24)}…"` : 'none'})`);
  check('T5c', !!sub5 && KANA.test(sub5.data.text) && sub5.data.text !== RAW5, 'polish translated the line into Japanese (kana present)');
  check('T5d', !!expr5, `player expression event (${expr5 ? expr5.data.emotion : 'none'})`);
  check('T5e', !!audio5, 'player audio chunks after polish');
  let log5 = '';
  for (let i = 0; i < 12; i++) { log5 = sessionLog(); if (sub5 && log5.includes(sub5.data.text)) break; await sleep(1000); }
  check('T5f', !!sub5 && log5.includes(sub5.data.text), 'session log holds the polished line');
  check('T5g', !log5.includes(RAW5), 'raw Chinese input never enters the session log');
  await shot('03-polished-ja');

  // ---- T6: off fallback ----
  console.log('=== T6 off fallback ===');
  await ev(() => { window.__tp = []; });
  // Host-side: thirdPerson=false → /player-line is a plain submit.
  patchCfg({ thirdPerson: false });
  await sleep(800);
  const RAW6 = '第三人称关闭后这句话应该直接发出去';
  const sent6 = await ev(async ([sid, text]) => {
    const r = await fetch('/live2d-voice/player-line', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, text }),
    });
    return r.status;
  }, [sessionId, RAW6]);
  await sleep(4000);
  const list6 = JSON.parse(await ev(() => JSON.stringify(window.__tp)));
  const playerEvents6 = list6.filter((e) => e.data?.speaker === 'player');
  const asst6 = list6.find((e) => e.name === 'subtitle' && e.data.role === 'assistant');
  check('T6a', sent6 === 200 && playerEvents6.length === 0, `off → no player SSE events (${playerEvents6.length})`);
  check('T6b', !!asst6 || list6.some((e) => e.name === 'audio' && e.data.speaker === undefined), 'off → assistant still replies to the submitted text');
  let log6 = '';
  for (let i = 0; i < 12; i++) { log6 = sessionLog(); if (log6.includes(RAW6)) break; await sleep(1000); }
  check('T6c', log6.includes(RAW6), 'off → raw text submitted as the user message');

  // View-side: ⚙ toggle off drops the second canvas; typed line goes the
  // first-person path (local echo subtitle, no player events).
  await ev(() => document.querySelector('.lv-hud [title*="快捷调整"]')?.click());
  await sleep(500);
  const toggled = await ev(() => {
    const rows = [...document.querySelectorAll('.lv-pop .lv-switch-row')];
    const row = rows.find((r) => r.textContent?.includes('第三人称模式'));
    if (!row) return { found: false };
    row.querySelector('button[role="switch"]')?.click();
    return { found: true };
  });
  check('T6d', toggled.found, '⚙ popover carries the 第三人称 switch');
  let canvasCount6 = 0;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    canvasCount6 = await ev(() => (document.querySelector('.lv-stage')?.dataset.lvPlayer ?? '') === '' ? 1 : 2);
    if (canvasCount6 === 1) break;
  }
  check('T6e', canvasCount6 === 1, `toggle off → player avatar unmounted (${canvasCount6 === 1 ? 'stage is AI-only' : 'still dual'})`);
  await shot('04-toggle-off');
  check('T7', pageErrors.length === 0, `zero pageerror (${pageErrors.length})`);
} catch (e) {
  console.error('SCRIPT ERROR:', e);
  await shot('99-error');
  process.exitCode = 1;
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} PASS =====`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
