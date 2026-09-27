#!/usr/bin/env node
/**
 * e2e: zero-API session boot (validates the shared helpers in lib/boot.mjs).
 *
 * Practice: suites must not burn a real LLM/TTS round just to obtain a
 * session id. This suite proves the whole zero-API boot path end to end:
 *
 *   - GUI: open an existing session row (no prompt), attach the Live2D
 *     tab, capture the session id from the /live2d-voice/stream request
 *   - the captured id must resolve to a log on disk (binding for the
 *     log-content assertions migrated suites rely on)
 *   - the session log must not grow during the run (proof no turn ran)
 *   - standalone entry mounts the full stage for the disk-latest session
 *   - zero pageerror across both pages
 *
 * Run: E2E_URL=... E2E_SESSIONS=... node e2e/verify-boot.mjs
 */
import {
	launch,
	streamCollector,
	openSessionRow,
	openLiveTab,
	latestSessionId,
	sessionLogPath,
	standaloneUrl,
	E2E_URL,
} from './lib/boot.mjs';
import { statSync } from 'node:fs';

const results = [];
const check = (id, ok, note = '') => {
	results.push(ok);
	console.log(`${ok ? '✓' : '✗'} ${id} ${note}`);
};

const browser = await launch();
try {
	const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
	const pageErrors = [];
	page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
	const streams = streamCollector(page);
	const sleep = (ms) => page.waitForTimeout(ms);

	await page.goto(E2E_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await sleep(8000);
	check('B1', pageErrors.length === 0, `page load clean (${pageErrors.length} errors)`);

	const diskId = latestSessionId();
	check('B2', Boolean(diskId), `disk-latest session (${diskId?.slice(0, 18)}…)`);

	const opened = await openSessionRow(page);
	await sleep(2500);
	check('B3', opened, 'existing session row clicked (no prompt sent)');

	const tab = await openLiveTab(page);
	await sleep(4500);
	const root1 = await page.evaluate(() => Boolean(document.querySelector('.lv-root')));
	check('B4', tab && root1, 'Live2D view mounted on the reused session');

	const captured = [...streams][streams.size - 1];
	check('B5', Boolean(captured), `session id captured from stream attach (${captured?.slice(0, 18)}…)`);

	const logPath = captured ? sessionLogPath(captured) : undefined;
	check('B6', Boolean(logPath), 'captured id resolves to a log on disk (log binding ok)');
	const sizeBefore = logPath ? statSync(logPath).size : -1;

	// Standalone entry with the disk-latest session: full stage, no GUI chrome.
	const page2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
	const pageErrors2 = [];
	page2.on('pageerror', (e) => pageErrors2.push(String(e).slice(0, 160)));
	await page2.goto(standaloneUrl(diskId), { waitUntil: 'domcontentloaded', timeout: 30000 });
	await sleep(6000);
	const root2 = await page2.evaluate(() => Boolean(document.querySelector('.lv-root')));
	check('B7', root2, 'standalone entry mounts the full stage');

	// The GUI page stayed open the whole time; the log must not have grown —
	// no turn ran, which is the whole point of the zero-API boot.
	await sleep(1500);
	const sizeAfter = logPath ? statSync(logPath).size : -1;
	check('B8', sizeBefore >= 0 && sizeAfter === sizeBefore, `session log untouched (${sizeBefore} B → ${sizeAfter} B)`);

	check('B9', pageErrors.length === 0 && pageErrors2.length === 0, `zero pageerror across both pages (${pageErrors.length + pageErrors2.length})`);
} catch (e) {
	console.error('suite crashed:', e);
	results.push(false);
} finally {
	await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
