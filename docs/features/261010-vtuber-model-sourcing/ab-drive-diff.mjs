#!/usr/bin/env node
/**
 * Controlled A/B pixel-diff probe for the param-id alias fix (exploratory
 * evidence, NOT daily automation — see docs/references/260927-e2e-testing.md).
 *
 * Question it answers: does the look drive actually *move* a model whose moc3
 * declares only the Cubism 2.1 UPPER_SNAKE ids (tsumiki / megumin), and does
 * the camelCase path still work (hiyori) / moc2 path unchanged (zongzi)?
 *
 * Method (per src/client/AGENTS.md: VLM head-turn judgement is unreliable →
 * objective pixel statistics):
 *  - pin the model via plugin config; enable gyroParallax, disable eyeTracking;
 *  - pin look gains via localStorage so the ONLY live channel is the gyro head
 *    turn (pan/roll/camera gains zeroed, angleRange 40) → the diff measures the
 *    drive, not layout movement;
 *  - feed synthetic DeviceOrientationEvents (calibrate neutral at gamma=0, then
 *    hold gamma=+30 / -30 → normalized ±1 * 0.45 tilt factor * gain 1 → ±18°);
 *  - shoot the canvas: neutral A1, neutral A2 (idle-motion noise baseline),
 *    turned P, turned M; assert |A1-P| and |P-M| >> |A1-A2|.
 *  - m4a1 (moc3 declaring neither official spelling) is the negative control:
 *    the resolver keeps the old no-op id there by design, so its "drive" diff
 *    must stay at noise level — proving the metric discriminates.
 *
 * Run: dsh-e2e run docs/features/261010-vtuber-model-sourcing/ab-drive-diff.mjs [model...]
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const TOKEN = process.env.DSH_E2E_TOKEN || 'e2etest';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = `${HOME}/live2d-voice.json`;
const LIB = '/root/.dsh/live2d-voice-models';
const SHOTS = resolve(import.meta.dirname, 'shots');
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';
const MODELS = process.argv.slice(2).length ? process.argv.slice(2)
	: ['tsumiki', 'megumin', 'hiyori', 'zongzi', 'm4a1'];
/** Look params pinned for the probe: pure gyro head yaw, no pan, no roll, no camera. */
const LOOK = {
	camPanGain: 0, gyroPanGain: 0, camAngleGain: 0, gyroAngleGain: 1,
	camRollGain: 0, gyroRollGain: 0, camEyeGain: 0, gyroEyeGain: 1,
	panRange: 0, angleRange: 40, rollRange: 0, bodyZGain: 0,
};

/** Expected resolved spelling per sample (angleX / eyeX / mouth). */
const EXPECTED = {
	tsumiki: ['PARAM_ANGLE_X', 'PARAM_EYE_BALL_X', 'PARAM_MOUTH_OPEN_Y'],
	megumin: ['PARAM_ANGLE_X', 'PARAM_EYE_BALL_X', 'PARAM_MOUTH_OPEN_Y'],
	hiyori: ['ParamAngleX', 'ParamEyeBallX', 'ParamMouthOpenY'],
	zongzi: ['PARAM_ANGLE_X', 'PARAM_EYE_BALL_X', 'PARAM_MOUTH_OPEN_Y'],
};

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok, note }); console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); };
const IDLE_OFF = process.env.IDLE_OFF === '1';
const BEFORE = readFileSync(CFG, 'utf8');
const pin = (name) => {
	const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
	Object.assign(cfg, { modelPath: LIB, modelSelection: name, gyroParallax: true, eyeTracking: false, liveMode: 'first' });
	// Test-harness control: idle motions are the dominant noise source on
	// high-animation models (hiyori, zongzi). idleInterval<=0 disables them.
	if (IDLE_OFF) cfg.idleInterval = 0;
	writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

/**
 * Diff percentage between two shots of the same crop.
 * MASK mode normalizes by the model's own silhouette instead of the crop area:
 * these canvases are mostly empty background, so an area-normalized number
 * stays small even when the head visibly turns.
 */
const diffStats = (a, b, box, mask = process.env.MASK === '1') => parseFloat(execSync(`python3 - <<'PY'
from PIL import Image, ImageChops
a = Image.open(${JSON.stringify(a)}).convert('RGB')
b = Image.open(${JSON.stringify(b)}).convert('RGB')
if a.size != b.size: b = b.resize(a.size)
box = tuple(${JSON.stringify(box)})
a = a.crop(box); b = b.crop(box)
d = ImageChops.difference(a, b).convert('L')
ap, bp = a.load(), b.load()
w, h = d.size
dp = d.load()
corners = [ap[2, 2], ap[w - 3, 2], ap[2, h - 3], ap[w - 3, h - 3]]
bg = [sum(c[i] for c in corners) // 4 for i in range(3)]
def off(p): return max(abs(p[0] - bg[0]), abs(p[1] - bg[1]), abs(p[2] - bg[2]))
MASK = ${mask ? 'True' : 'False'}
changed = total = 0
for y in range(0, h, 2):
    for x in range(0, w, 2):
        if MASK and not (off(ap[x, y]) > 45 or off(bp[x, y]) > 45):
            continue
        total += 1
        if dp[x, y] > 24:
            changed += 1
print(f"{100.0 * changed / max(total, 1):.3f}")
PY`, { encoding: 'utf8' }).trim());

/** 3-up contact sheet (neutral | +tilt | -tilt), cropped to the canvas. */
const sheet = (out, imgs, labels, box) => execSync(`python3 - <<'PY'
from PIL import Image, ImageDraw
box = ${JSON.stringify(box)}
box = tuple(${JSON.stringify(box)})
ims = [Image.open(p).convert('RGB').crop(box) for p in ${JSON.stringify(imgs)}]
ims = [i.resize((260, int(i.height * 260 / i.width))) for i in ims]
pad, top = 10, 26
w = sum(i.width for i in ims) + pad * (len(ims) + 1)
h = max(i.height for i in ims) + top + pad
c = Image.new('RGB', (w, h), (18, 18, 22)); d = ImageDraw.Draw(c)
x = pad
for im, lab in zip(ims, ${JSON.stringify(labels)}):
    c.paste(im, (x, top)); d.text((x, 6), lab, fill=(230, 230, 230)); x += im.width + pad
c.save(${JSON.stringify(out)})
PY`, { encoding: 'utf8' }).trim();

const browser = await chromium.launch({
	executablePath: CHROMIUM,
	headless: true,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 720, height: 1000 }, deviceScaleFactor: 1 });
await ctx.addInitScript((look) => {
	localStorage.setItem('lv-look-params-v2', JSON.stringify(look));
	window.__tiltSeen = 0;
	window.addEventListener('deviceorientation', () => { window.__tiltSeen++; }, true);
}, LOOK);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`${e.message}`));

/** Burst synthetic orientation events: calibrate neutral at gamma=0, then hold `gamma`. */
const tilt = (gamma, samples = 60) => page.evaluate(({ gamma, samples }) => {
	const send = (g) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 45, gamma: g, absolute: false }));
	for (let i = 0; i < 12; i++) send(0);
	for (let i = 0; i < samples; i++) send(gamma);
}, { gamma, samples });

mkdirSync(SHOTS, { recursive: true });
	const created = await fetch(`${ORIGIN}/live2d-voice/session`, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ title: 'param-alias-ab' }),
	}).then((r) => r.json());
	const URL = `${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(created.sessionId)}`;

	try {
		for (const model of MODELS) {
			pin(model);
			await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
			await page.waitForSelector('.lv-stage canvas', { timeout: 30000 });
			await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 15000 }).catch(() => {});
			await page.waitForTimeout(6000); // model settled, mount toast gone
			const ids = await page.evaluate(() => {
				try { return JSON.parse(document.querySelector('.lv-stage').dataset.lvParamIds); } catch { return null; }
			});
			const bb = await (await page.$('.lv-stage canvas')).boundingBox();
			const box = [Math.round(bb.x), Math.round(bb.y), Math.round(bb.x + bb.width), Math.round(bb.y + bb.height)];
			const clip = { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] };
			// Head-only crop: idle arm/body animation lives below the shoulders.
			const head = [box[0], box[1], box[2], box[1] + Math.round((box[3] - box[1]) * 0.45)];
			// Body crop minus the bottom strip: the HUD pill and the mount toast
			// live there and would count as "model" pixels under the mask.
			const body = [box[0], box[1], box[2], box[3] - Math.round((box[3] - box[1]) * 0.2)];
			const shot = async (tag) => {
				const p = `${SHOTS}/${model}-${tag}.png`;
				await page.screenshot({ path: p, clip, timeout: 60000 });
				return p;
			};

			const A1 = await shot('A1-neutral');
			await page.waitForTimeout(2000);
			const A2 = await shot('A2-neutral');
			await tilt(30); await page.waitForTimeout(2500);
			const P = await shot('P-tilt+');
			await tilt(-30); await page.waitForTimeout(2500);
			const M = await shot('M-tilt-');

			const seen = await page.evaluate(() => window.__tiltSeen);
			const noise = diffStats(A1, A2, box);
			const drive = diffStats(A1, P, box);
			const span = diffStats(P, M, box);
			const back = diffStats(A2, M, box);
			const hNoise = diffStats(A1, A2, head);
			const hDrive = diffStats(A1, P, head);
			const hSpan = diffStats(P, M, head);
			sheet(`${SHOTS}/${model}-sheet.png`, [A1, P, M], [`${model} neutral`, '+tilt (drive)', '-tilt (drive)'], box);
			console.log(`  ${model}: ids=${ids?.look?.angleX ?? '—'} events=${seen} IDLE_OFF=${IDLE_OFF}`);
			console.log(`    canvas noise=${noise}% drive=${drive}% span=${span}% back=${back}%`);
			console.log(`    head   noise=${hNoise}% drive=${hDrive}% span=${hSpan}%`);
			const mNoise = diffStats(A1, A2, body);
			const mDrive = diffStats(A1, P, body);
			const mSpan = diffStats(P, M, body);
			console.log(`    silhouette(MASK=${process.env.MASK === '1'}) noise=${mNoise}% drive=${mDrive}% span=${mSpan}%`);
			const hmNoise = diffStats(A1, A2, head);
			const hmDrive = diffStats(A1, P, head);
			console.log(`    head-silhouette noise=${hmNoise}% drive=${hmDrive}%`);

			if (model === 'm4a1') {
				check(`negative control ${model}: drive stays at noise level`, mDrive < Math.max(mNoise * 2, 0.4), `silhouette noise=${mNoise}% drive=${mDrive}% (no official spelling declared → no-op by design)`);
				check(`${model} keeps the format default (camelCase, undriven by design)`,
					ids?.look?.angleX === 'ParamAngleX' && ids?.mouth === 'ParamMouthOpenY', `${ids?.look?.angleX}/${ids?.mouth}`);
			} else {
				check(`${model}: tilt drives real pixels (silhouette metric)`, mDrive > mNoise * 2 && mDrive > 2, `noise=${mNoise}% drive=${mDrive}% span=${mSpan}%`);
				check(`${model}: head crop drives real pixels (arm/idle animation excluded)`, hDrive > hNoise * 3 && hDrive > 1.5, `head noise=${hNoise}% drive=${hDrive}% span=${hSpan}%`);
				check(`${model}: head silhouette responds to tilt`, hmDrive > hmNoise * 2 && hmDrive > 2, `noise=${hmNoise}% drive=${hmDrive}%`);
				check(`${model}: opposite tilts differ (pose is the variable)`, span > noise * 3 && span >= drive * 0.8, `span=${span}% drive=${drive}%`);
				check(`${model}: tilt events reached the page`, seen > 50, `seen=${seen}`);
				const [angle, eye, mouth] = EXPECTED[model] ?? [];
				check(`${model} publishes ${angle ?? 'the declared'} on dataset.lvParamIds`,
					ids && ids.look?.angleX === angle && ids.look?.eyeX === eye && ids.mouth === mouth,
					ids ? `${ids.look.angleX}/${ids.look.eyeX}/${ids.mouth}` : 'dataset.lvParamIds missing');
			}
		}
	check('no page errors across all loads', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} finally {
	writeFileSync(CFG, BEFORE);
	await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
