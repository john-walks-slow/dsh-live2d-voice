#!/usr/bin/env node
/**
 * Phase 3 e2e: subtitle translation (real LLM), model catalog + picker,
 * per-workspace config overlay — against the e2e instance (:4188).
 *
 * P1 translation: watched session → reply (ja) → SSE must deliver
 *    subtitle (with lineId) + subtitle-translation (zh) events and the DOM
 *    must render the bilingual row.
 * P2 model picker: ⚙ shows the catalog (multi-model fixture under
 *    /root/.dsh-e2e-test-models) → pick → /model current changes, stage
 *    re-renders.
 * P3 workspace overlay: workspaces[cwd] override (modelSelection + voiceId)
 *    → /model?session & /config?session reflect the overlay while the
 *    global config keeps its own values.
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const { chromium } = pw;

const url = process.env.E2E_URL ?? `http://127.0.0.1:${process.env.DSH_E2E_PORT}/?token=${process.env.DSH_E2E_TOKEN || 'e2etest'}`;
const CFG = process.env.E2E_CFG ?? `${process.env.DSH_E2E_HOME}/live2d-voice.json`;
const SHOT = (n) => `/tmp/lvp3-${n}.png`;
const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };

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

try {
  // baseline: global selection = haru (first), multi-model fixture in place
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  cfg.modelPath = '/root/.dsh-e2e-test-models'; // multi-model fixture: haru + haru-alt
  cfg.modelSelection = 'haru';
  delete cfg.workspaces;
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');

  console.log('=== boot + session ===');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(9000);
  await ev(() => { const ed = document.querySelector('[contenteditable="true"][aria-label*="Describe"]'); if (!ed) return false; ed.focus(); return true; });
  await page.keyboard.type('今天天气怎么样？请用一句话回答', { delay: 20 });
  await page.keyboard.press('Enter');
  await sleep(12000);
  const ids = [...followSessionIds];
  const sessionId = ids[ids.length - 1];
  check('P0a', !!sessionId, `session captured (${sessionId?.slice(0, 18)}…)`);

  // Live2D tab
  await ev(() => {
    const matches = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent?.trim() === 'Live2D');
    let t = matches[0];
    while (t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'tab') t = t.parentElement;
    t?.click();
  });
  await sleep(4000);
  check('P0b', !!(await ev(() => document.querySelector('.lv-root'))), 'Live2D view mounted');

  // SSE probe incl. subtitle-translation
  await ev((sid) => {
    window.__p3 = [];
    window.__p3es = new EventSource(`/live2d-voice/stream?session=${encodeURIComponent(sid)}`);
    for (const name of ['speech-start', 'subtitle', 'subtitle-translation', 'speech-end', 'error']) {
      window.__p3es.addEventListener(name, (raw) => {
        window.__p3.push({ name, data: JSON.parse(raw.data), t: Date.now() });
      });
    }
  }, sessionId);
  await sleep(800);

  // Submit a fresh turn NOW (watched) via the host message route.
  const sent = await ev(async (sid) => {
    const r = await fetch('/live2d-voice/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, text: '今日の天気はどう？一言で答えて' }),
    });
    return r.status;
  }, sessionId);
  check('P0c', sent === 200, `message submitted (${sent})`);

  // ---- P1: translation of the reply ----
  console.log('=== P1 translation ===');
  let sub = null, tr = null;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const events = await ev(() => JSON.stringify(window.__p3));
    const list = JSON.parse(events);
    sub = list.find((e) => e.name === 'subtitle' && e.data.role === 'assistant' && (e.data.text ?? '').length >= 4) ?? sub;
    tr = list.find((e) => e.name === 'subtitle-translation' && (e.data.text ?? '').length >= 2) ?? tr;
    if (sub && tr) break;
  }
  check('P1a', !!sub, `assistant subtitle (${sub ? `"${String(sub.data.text).slice(0, 22)}…"` : 'none'})`);
  check('P1b', !!sub?.data?.lineId, `subtitle carries lineId (${sub?.data?.lineId})`);
  check('P1c', !!tr, `subtitle-translation event (${tr ? `"${String(tr.data.text).slice(0, 22)}…"` : 'none'})`);
  if (sub && tr) {
    check('P1d', tr.data.lineId !== undefined && tr.data.text !== sub.data.text, `translation differs (lineId=${tr.data.lineId})`);
    // bilingual subtitle rendered in DOM
    let domTr = null;
    for (let i = 0; i < 10; i++) {
      domTr = await ev(() => [...document.querySelectorAll('.lv-sub-card .lv-sub-tr')].map((el) => el.textContent).join('|'));
      if (domTr) break;
      await sleep(1000);
    }
    check('P1e', !!domTr, `DOM translation row (${String(domTr).slice(0, 26)}…)`);
  }
  await shot('01-translation');

  // ---- P2: model picker ----
  console.log('=== P2 model picker ===');
  const modelInfo = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/model', { headers: { accept: 'application/json' } });
    return JSON.stringify(await r.json());
  }));
  check('P2a', (modelInfo.models ?? []).length === 2 && modelInfo.current === 'haru',
    `catalog=${(modelInfo.models ?? []).map((m) => m.name).join(',')} current=${modelInfo.current}`);
  // open ⚙, model section visible
  await ev(() => document.querySelector('.lv-hud [title*="快捷调整"]')?.click());
  await sleep(400);
  const popInfo = await ev(() => {
    const section = [...document.querySelectorAll('.lv-pop h4')].find((h) => h.textContent === '角色模型');
    if (!section) return { hasSection: false, buttons: [] };
    let el = section.nextElementSibling;
    while (el && !el.classList.contains('lv-langs')) el = el.nextElementSibling;
    return { hasSection: true, buttons: el ? [...el.querySelectorAll('button')].map((b) => b.textContent) : [] };
  });
  check('P2b', popInfo.hasSection && popInfo.buttons.length === 2, `⚙ model section (${JSON.stringify(popInfo.buttons)})`);
  // click haru-alt (the model section's pills — NOT the first .lv-langs,
  // which is the voice section since the v1.1.0 HUD rework)
  const clicked = await ev(() => {
    const section = [...document.querySelectorAll('.lv-pop h4')].find((h) => h.textContent === '角色模型');
    if (!section) return false;
    let el = section.nextElementSibling;
    while (el && !el.classList.contains('lv-langs')) el = el.nextElementSibling;
    if (!el) return false;
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'haru-alt');
    btn?.click();
    return Boolean(btn);
  });
  if (!clicked) console.log('  (model button not found — section missing?)');
  await sleep(2500);
  const modelInfo2 = JSON.parse(await ev(async () => {
    const r = await fetch('/live2d-voice/model', { headers: { accept: 'application/json' } });
    return JSON.stringify(await r.json());
  }));
  check('P2c', modelInfo2.current === 'haru-alt', `selection switched to haru-alt (current=${modelInfo2.current})`);
  let stageOk = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    stageOk = !!(await ev(() => document.querySelector('.lv-stage canvas')));
    if (stageOk) break;
  }
  check('P2d', stageOk, 'stage re-rendered after model switch');
  await shot('02-model-switched');

  // ---- P3: workspace overlay ----
  console.log('=== P3 workspace overlay ===');
  // derive cwd from the session storage slug
  let cwd = null;
  for (const dir of readdirSync(`${process.env.DSH_E2E_HOME}/sessions`)) {
    try {
      if (!readdirSync(`${process.env.DSH_E2E_HOME}/sessions/${dir}`).includes(sessionId)) continue;
      const head = execSync(`zstd -dc ${process.env.DSH_E2E_HOME}/sessions/${dir}/${sessionId}/session.v3.jsonl.zstd 2>/dev/null | head -1`).toString();
      cwd = JSON.parse(head).cwd ?? null;
      break;
    } catch {}
  }
  check('P3a', !!cwd, `session cwd resolved (${cwd})`);
  if (cwd) {
    const maid = 'abf4fa2e25634b41aadc4e0ef9ddaea5'; // 元气女仆 preset
    const cfg3 = JSON.parse(readFileSync(CFG, 'utf8'));
    cfg3.workspaces = { [cwd]: { modelSelection: 'haru', voiceId: maid } };
    writeFileSync(CFG, JSON.stringify(cfg3, null, 2) + '\n');
    await sleep(600);
    const eff = JSON.parse(await ev(async (sid) => {
      const r = await fetch(`/live2d-voice/model?session=${encodeURIComponent(sid)}`, { headers: { accept: 'application/json' } });
      return JSON.stringify(await r.json());
    }, sessionId));
    const effCfg = JSON.parse(await ev(async (sid) => {
      const r = await fetch(`/live2d-voice/config?session=${encodeURIComponent(sid)}`, { headers: { accept: 'application/json' } });
      return JSON.stringify((await r.json()).config);
    }, sessionId));
    check('P3b', eff.current === 'haru', `workspace model override beats global (current=${eff.current}, global=haru-alt)`);
    check('P3c', effCfg.voiceId === maid, `workspace voiceId override (voiceId=${String(effCfg.voiceId).slice(0, 8)}…)`);
    // P3d (BLK-1 regression): modelPath override — the catalog URL generated
    // against the override root must serve through the multi-root asset route.
    const cfg3b = JSON.parse(readFileSync(CFG, 'utf8'));
    cfg3b.workspaces = { [cwd]: { modelPath: '/root/.dsh-e2e-test-models2', modelSelection: 'haru' } };
    writeFileSync(CFG, JSON.stringify(cfg3b, null, 2) + '\n');
    await sleep(600);
    const effAlt = JSON.parse(await ev(async (sid) => {
      const r = await fetch(`/live2d-voice/model?session=${encodeURIComponent(sid)}`, { headers: { accept: 'application/json' } });
      return JSON.stringify(await r.json());
    }, sessionId));
    check('P3d-a', effAlt.current === 'haru' && (effAlt.url ?? '').includes('/haru/'),
      `modelPath override catalog (current=${effAlt.current}, url=${effAlt.url})`);
    const assetStatus = await ev(async (u) => (await fetch(u)).status, effAlt.url);
    check('P3d-b', assetStatus === 200, `override-root asset serves 200 (${assetStatus}, ${effAlt.url})`);
    const globalModel = JSON.parse(await ev(async () => {
      const r = await fetch('/live2d-voice/model', { headers: { accept: 'application/json' } });
      return JSON.stringify(await r.json());
    }));
    const globalStatus = await ev(async (u) => (await fetch(u)).status, globalModel.url);
    check('P3d-c', globalStatus === 200, `global-root asset still serves 200 (${globalStatus}, ${globalModel.url})`);
    // cleanup: drop the override
    const cfg4 = JSON.parse(readFileSync(CFG, 'utf8'));
    delete cfg4.workspaces;
    writeFileSync(CFG, JSON.stringify(cfg4, null, 2) + '\n');
  }
  check('P4', pageErrors.length === 0, `zero pageerror (${pageErrors.length})`);
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
