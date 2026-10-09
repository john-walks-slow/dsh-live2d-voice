#!/usr/bin/env node
/**
 * Standard-parameter id resolution e2e — mostly browser-less.
 *
 * Two parts:
 *  A. Pure resolver (src/client/param-ids.ts, imported through node's type
 *     stripping): camelCase models keep camelCase, UPPER_SNAKE moc3 models
 *     (legacy ports / game assets) resolve to the ids they actually declare,
 *     "neither spelling" keeps the exact no-op id it used before.
 *  B. Live page: pin the catalog to a real library model via the plugin
 *     config, open the standalone entry and read the `dataset.lvParamIds`
 *     contract that mountModel publishes — proving the wiring end to end for
 *     one camelCase model (hiyori) and one UPPER_SNAKE moc3 model (tsumiki).
 *
 * Regression this locks down: the drive used to key the id spelling off the
 * FILE FORMAT, so every moc3 rig using PARAM_* ids was silently undriven
 * (26 models in the local library, incl. the whole game-ripped batch).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { resolveParamId, resolveParamIds, STANDARD_PARAM_PAIRS } from '../src/client/param-ids.ts';

const { chromium } = pw;
const PORT = process.env.DSH_E2E_PORT;
const HOME = process.env.DSH_E2E_HOME;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CFG = HOME ? `${HOME}/live2d-voice.json` : null;
const LIB = '/root/.dsh/live2d-voice-models';
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id}${note ? ` — ${note}` : ''}`); };

// ── Part A: pure resolver ───────────────────────────────────────────────────
const CAMEL = new Set(Object.values(STANDARD_PARAM_PAIRS).map(([c]) => c));
const UPPER = new Set(Object.values(STANDARD_PARAM_PAIRS).map(([, u]) => u));
const probe = (ids, kind) => resolveParamIds(kind, (id) => ids.has(id));
const has = (o, k, v) => o[k] === v;

const camel = probe(CAMEL, 'moc3');
check('camelCase moc3 model resolves camelCase for every driven id',
	Object.entries(STANDARD_PARAM_PAIRS).every(([k, pair]) => (k === 'mouth' ? camel.mouth : camel.look[k]) === pair[0]));

const upper3 = probe(UPPER, 'moc3');
check('UPPER_SNAKE moc3 model resolves the ids it declares (regression)',
	has(upper3.look, 'angleX', 'PARAM_ANGLE_X') && has(upper3.look, 'eyeX', 'PARAM_EYE_BALL_X') &&
	has(upper3.look, 'browRY', 'PARAM_BROW_R_Y') && upper3.mouth === 'PARAM_MOUTH_OPEN_Y');

const both = probe(new Set([...CAMEL, ...UPPER]), 'moc3');
check('both spellings declared → camelCase wins (no behaviour change)',
	both.look.angleX === 'ParamAngleX' && both.mouth === 'ParamMouthOpenY');

const neither3 = probe(new Set(), 'moc3');
const neither2 = probe(new Set(), 'moc2');
check('neither spelling declared → format default (same no-op id as before)',
	neither3.look.angleX === 'ParamAngleX' && neither3.mouth === 'ParamMouthOpenY' &&
	neither2.look.angleX === 'PARAM_ANGLE_X' && neither2.mouth === 'PARAM_MOUTH_OPEN_Y');

check('resolver only ever emits one of the two official spellings',
	Object.values(resolveParamIds('moc3', (id) => UPPER.has(id)).look).every((id) => UPPER.has(id)) &&
	resolveParamId(STANDARD_PARAM_PAIRS.eyeY, 'moc3', () => false) === 'ParamEyeBallY');

// ── Part B: live page contract ──────────────────────────────────────────────
const before = existsSync(CFG) ? readFileSync(CFG, 'utf8') : null;
const pinModel = (name) => {
	const cfg = existsSync(CFG) ? JSON.parse(readFileSync(CFG, 'utf8')) : {};
	// Top-level pin: the per-workspace override only applies once an agent
	// session carries a cwd, which the empty e2e session does not guarantee.
	cfg.modelPath = LIB;
	cfg.modelSelection = name;
	writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};
/** ids published by mountModel on the model container. */
const readParamIds = (page) => page.evaluate(() => {
	const el = document.querySelector('.lv-stage');
	const raw = el?.dataset?.lvParamIds;
	try { return raw ? JSON.parse(raw) : null; } catch { return null; }
});

if (!PORT || !HOME) {
	console.log('… DSH_E2E_PORT/DSH_E2E_HOME not set — skipping the live-page part (run via `dsh-e2e run`).');
} else {
	const browser = await chromium.launch({
		executablePath: CHROMIUM,
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
	});
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await ctx.newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	try {
		const created = await fetch(`${ORIGIN}/live2d-voice/session`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: 'param-ids-e2e' }),
		}).then((r) => r.json());

		for (const [model, expectAngle, expectEye, expectMouth] of [
			['tsumiki', 'PARAM_ANGLE_X', 'PARAM_EYE_BALL_X', 'PARAM_MOUTH_OPEN_Y'],
			['hiyori', 'ParamAngleX', 'ParamEyeBallX', 'ParamMouthOpenY'],
			// moc2 (Cubism 2.1) has no enumerable parameter table and its
			// getParamIndex() also invents phantom indices, so it must keep the
			// UPPER_SNAKE format default instead of probing (261010 regression).
			['zongzi', 'PARAM_ANGLE_X', 'PARAM_EYE_BALL_X', 'PARAM_MOUTH_OPEN_Y'],
		]) {
			pinModel(model);
			await page.goto(`${ORIGIN}/live2d-voice/app?session=${encodeURIComponent(created.sessionId)}`, {
				waitUntil: 'domcontentloaded', timeout: 30000,
			});
			await page.waitForSelector('.lv-stage canvas', { timeout: 25000 });
			await page.waitForFunction(() => Boolean(document.querySelector('.lv-stage')?.dataset?.lvParamIds), null, { timeout: 15000 })
				.catch(() => {});
			const ids = await readParamIds(page);
			check(`live page resolves ${model} (${expectAngle})`,
				Boolean(ids) && ids.look?.angleX === expectAngle && ids.look?.eyeX === expectEye && ids.mouth === expectMouth,
				ids ? `${ids.look?.angleX} / ${ids.mouth}` : 'dataset.lvParamIds missing');
		}
		check('no page errors during model loads', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
	} finally {
		if (before !== null) writeFileSync(CFG, before); else if (existsSync(CFG)) writeFileSync(CFG, '{}\n');
		await browser.close();
	}
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
