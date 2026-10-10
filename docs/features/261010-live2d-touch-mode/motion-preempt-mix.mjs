#!/usr/bin/env node
/**
 * 抢占的**混合语义**：新动作是从"旧动作最后一帧的姿态"淡入（连续），还是从基础姿态淡入（f=0 snap）？
 * （261010，抢占方案的最后一道前置钉子）
 *
 * 做法（headless，不需要真机）：临时探针构建发布每帧姿态 `dataset.lvPoseProbe`（ANGLE_X/Y/Z、BODY_ANGLE_X、MOUTH）
 * 与 `window.__lvProbe`（status / stopAll / start）。步骤：
 *   1. 触发手势 A（FlickRight）并让它进入播放态；
 *   2. 以 ~25ms 采样姿态，建立"基准帧间增量"分布；
 *   3. 调 `__lvProbe.stopAll()` + `start('FlickLeft', 0)`（模拟抢占：与实现将要做的完全相同的一对调用）；
 *   4. 继续采样，比较**跨越抢占那一次的帧间增量**与基准分布：
 *        跨越增量 ≈ 基准量级  ⇒ 从旧动作末帧姿态淡入（连续，无 snap）
 *        跨越增量 ≫ 基准量级  ⇒ 从基础姿态淡入（每次抢占都会 snap）
 *
 * 用法：dsh-e2e run docs/features/261010-live2d-touch-mode/motion-preempt-mix.mjs
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 25);
const PRE_MS = Number(process.env.PRE_MS ?? 1200);
const POST_MS = Number(process.env.POST_MS ?? 1200);
const ROUNDS = Number(process.env.ROUNDS ?? 3);

if (!PORT || !CFG) { console.log('… 需要 DSH_E2E_PORT/DSH_E2E_HOME（走 dsh-e2e run）'); process.exit(2); }

const BEFORE = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pin = () => {
  const cfg = JSON.parse(BEFORE ?? '{}');
  Object.assign(cfg, {
    modelPath: '/root/.dsh/live2d-voice-models', modelSelection: 'izumi', liveMode: 'first',
    eyeTracking: false, gyroParallax: false, idleInterval: 8, touchMode: true,
  });
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});

try {
  pin();
  const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  const { sessionId } = await fetch(`${ORIGIN}/live2d-voice/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: '/root' }),
  }).then((r) => r.json());
  await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);

  const hasProbe = await page.evaluate(() => Boolean((window).__lvProbe));
  if (!hasProbe) { console.log('× 页面里没有 __lvProbe（standalone 探针构建没被服务？）'); process.exit(1); }
  console.log('探针就位；开始测量抢占前后的姿态连续性\n');

  const sample = () => page.evaluate(() => {
    const st = document.querySelector('.lv-stage');
    const pose = st?.dataset?.lvPoseProbe ?? null;
    return { pose, status: (window).__lvProbe.status() };
  });

  for (let round = 1; round <= ROUNDS; round++) {
    // 1) 起播手势 A（直接用探针起播，避免滑动路径的干扰）
    await page.evaluate(async () => { await (window).__lvProbe.start('FlickRight', 0); });
    await page.waitForTimeout(300);

    const trail = [];
    const push = async (tag) => { const s = await sample(); trail.push({ tag, ...s, t: Date.now() }); };

    const preEnd = Date.now() + PRE_MS;
    while (Date.now() < preEnd) { await push('pre'); await page.waitForTimeout(SAMPLE_MS); }

    // 2) 模拟抢占：与实现将要做的一模一样的一对调用
    const beforeSwitch = await sample();
    await page.evaluate(async () => {
      (window).__lvProbe.stopAll();
      await (window).__lvProbe.start('FlickLeft', 0);
    });
    const justAfter = await sample();

    const postEnd = Date.now() + POST_MS;
    while (Date.now() < postEnd) { await push('post'); await page.waitForTimeout(SAMPLE_MS); }

    // 3) 计算帧间增量（只统计"值发生了变化"的样本对，避开 headless 低帧率的重复采样）
    const vec = (p) => (p ? p.split(',').map(Number) : null);
    const dist = (a, b) => {
      const va = vec(a), vb = vec(b);
      if (!va || !vb) return null;
      // 姿态量纲差异大（ANGLE 是度、MOUTH 是 0..1），分开报：角度平均增量 + 嘴部增量
      const angles = [0, 1, 2, 3].map((i) => Math.abs(va[i] - vb[i]));
      return { angleMax: Math.max(...angles), mouth: Math.abs(va[4] - vb[4]) };
    };
    const changedSteps = [];
    for (let i = 1; i < trail.length; i++) {
      const d = dist(trail[i - 1].pose, trail[i].pose);
      if (!d) continue;
      if (d.angleMax > 0 || d.mouth > 0) changedSteps.push({ i, ...d, tag: `${trail[i - 1].tag}→${trail[i].tag}` });
    }
    const preSteps = changedSteps.filter((s) => s.tag === 'pre→pre');
    // 关键：跨越抢占后的**第一个真正变化的帧**与"抢占前最后一帧"之间的增量。
    // （beforeSwitch→justAfter 常常落在同一帧内，增量 0 是采样假象，不能当证据。）
    const lastPre = [...trail].reverse().find((x) => x.tag === 'pre')?.pose ?? beforeSwitch.pose;
    const firstPostChanged = trail.filter((x) => x.tag === 'post').find((x) => x.pose && x.pose !== lastPre)?.pose ?? null;
    const crossStep = firstPostChanged ? dist(lastPre, firstPostChanged) : dist(beforeSwitch.pose, justAfter.pose);
    const sameFrame = beforeSwitch.pose === justAfter.pose;
    const baseline = preSteps.map((s) => s.angleMax).sort((a, b) => a - b);
    const median = baseline.length ? baseline[Math.floor(baseline.length / 2)] : null;
    const maxBase = baseline.length ? baseline[baseline.length - 1] : null;
    const mouthBase = preSteps.map((s) => s.mouth).sort((a, b) => a - b);
    const mouthMax = mouthBase.length ? mouthBase[mouthBase.length - 1] : null;

    console.log(`== 第 ${round} 轮 ==`);
    console.log(`抢占前：${changedSteps.length} 次变化样本；基准帧间角度最大增量 中位=${median === null ? '-' : median.toFixed(3)} 最大=${maxBase === null ? '-' : maxBase.toFixed(3)}；嘴部最大=${mouthMax === null ? '-' : mouthMax.toFixed(4)}`);
    console.log(`抢占瞬间（同帧采样=${sameFrame ? '是（增量 0 为假象）' : '否'}）：跨越第一个变化帧的角度最大增量=${crossStep ? crossStep.angleMax.toFixed(3) : '-'}，嘴部=${crossStep ? crossStep.mouth.toFixed(4) : '-'}`);
    console.log(`抢占前状态=${JSON.stringify(beforeSwitch.status)} → 抢占后=${JSON.stringify(justAfter.status)}`);
    const verdict = crossStep && maxBase !== null
      ? (crossStep.angleMax <= Math.max(maxBase * 1.5, 1) ? '连续（≈基准量级）→ 从旧动作末帧姿态淡入' : '跳变（≫基准）→ 从基础姿态淡入（每次抢占都会 snap）')
      : '样本不足';
    console.log(`判读：${verdict}\n`);
    await page.evaluate(() => (window).__lvProbe.stopAll());
    await page.waitForTimeout(400);
  }
} finally {
  writeFileSync(CFG, BEFORE ?? '{}\n');
  await browser.close();
}
