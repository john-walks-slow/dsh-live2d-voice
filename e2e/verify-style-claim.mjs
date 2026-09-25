#!/usr/bin/env node
/**
 * e2e: style-tag ownership under client HMR reloads (regression for
 * docs/issues/260925-live-button-style-loss).
 *
 * Bug: injectLiveStyles() appended the <style> without a data-plugin
 * attribute. The host module system claims untagged <style> tags at
 * materialization time (claimStyles), which runs BEFORE cordis apply(),
 * so the tag was never attributed to dsh-live2d-voice. Any other plugin
 * that (re)materialized claimed it; that plugin's next HMR reload ran
 * removeOwnedStyles and deleted OUR stylesheet — every lv-* rule vanished
 * (the Live entry button visibly lost its pill styling).
 *
 * Fix: tag the element with data-plugin="dsh-live2d-voice" at creation.
 *
 * This script drives the real mechanism: it mutates dsh-token-game's
 * client bundle twice (content change → rebuilt SSE frame → in-tab HMR
 * reload) and asserts our style tag survives, correctly attributed.
 * NOTE: the mutations also hot-reload dsh-token-game in any other tab
 * connected to the same instance (identical content after restore).
 *
 * Run: node e2e/verify-style-claim.mjs   (e2e instance on :4188)
 */
import pw from '/root/projects/camoufox-mcp/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const PROBE = '/root/projects/token-game/plugins/dsh-token-game/lib/client.js';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:4188/?token=e2etest';
const SELF_ID = 'dsh-live2d-voice';

const results = [];
const check = (id, ok, note = '') => {
	results.push(ok);
	console.log(`${ok ? '✓' : '✗'} ${id} ${note}`);
};

let browser;
try {
	browser = await pw.chromium.launch({
		executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome',
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
	});
	const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
	const frames = [];
	page.on('console', (m) => { if (m.text().startsWith('[sse]')) frames.push(m.text()); });

	await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.waitForTimeout(8000);
	await page.evaluate(() => {
		const es = new EventSource('/plugins/events');
		es.onmessage = (e) => console.log(`[sse] ${e.data.slice(0, 120)}`);
	});

	const snap = () => page.evaluate(() => {
		const el = document.getElementById('dsh-live2d-voice-styles');
		const btn = document.querySelector('.lv-live-entry');
		const cs = btn ? getComputedStyle(btn) : null;
		return {
			tags: document.querySelectorAll('style#dsh-live2d-voice-styles').length,
			owner: el === null ? 'GONE' : (el.getAttribute('data-plugin') ?? 'null'),
			radius: cs?.borderRadius ?? null,
		};
	});

	console.log('=== STAGE 1: boot state ===');
	let s = await snap();
	console.log(JSON.stringify(s));
	check('style tag present', s.tags === 1);
	check(`style tag claimed by ${SELF_ID}`, s.owner === SELF_ID, `owner=${s.owner}`);
	check('live button pill styled', s.radius === '999px', `radius=${s.radius}`);

	const orig = readFileSync(PROBE, 'utf8');
	try {
		console.log('=== STAGE 2: two external plugin rebuilds (HMR claim/remove dance) ===');
		for (const marker of ['verify-style-claim-a', 'verify-style-claim-b']) {
			writeFileSync(PROBE, `${orig}\n//${marker}\n`);
			const deadline = Date.now() + 12000;
			let before = frames.length;
			while (Date.now() < deadline) {
				await page.waitForTimeout(800);
				if (frames.length > before) break;
			}
		}
		await page.waitForTimeout(2000);
		s = await snap();
		console.log(JSON.stringify(s));
		check('style tag survives external HMR reloads', s.owner === SELF_ID && s.tags === 1, `owner=${s.owner} tags=${s.tags}`);
		check('live button still styled', s.radius === '999px', `radius=${s.radius}`);
		check('both rebuilt frames observed', frames.filter((f) => f.includes('dsh-token-game')).length >= 2);
	} finally {
		writeFileSync(PROBE, orig);
		await page.waitForTimeout(3000);
	}
	s = await snap();
	check('probe restored, style tag still ours', s.owner === SELF_ID, `owner=${s.owner}`);
} catch (e) {
	check('script ran to completion', false, String(e).slice(0, 160));
} finally {
	await browser?.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
