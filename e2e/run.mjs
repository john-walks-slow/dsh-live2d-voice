#!/usr/bin/env node
/**
 * e2e tier runner — encodes which suites may run by default.
 *
 *   node e2e/run.mjs              # light tier (default): zero-API suites
 *   node e2e/run.mjs light
 *   node e2e/run.mjs heavy        # real-API suites — explicit request only
 *   node e2e/run.mjs verify-live  # run specific suites by name
 *
 * Light = no real LLM/TTS/ASR round can possibly be burned (assertions are
 * static/DOM/config only). Heavy = at least one real API round; per the
 * e2e practice (docs/references/260927-e2e-testing.md) these run only when
 * explicitly requested or when the change under test is that suite's own
 * business — never as a blanket "make everything green" pass.
 *
 * Requires a running e2e instance (see the dsh-e2e skill); set E2E_URL /
 * E2E_SESSIONS / E2E_CFG when overriding the DSH_E2E_* defaults injected by `dsh-e2e run`.
 */
import { spawnSync } from 'node:child_process';

const LIGHT = [
	'verify-boot', // zero-API session boot helpers (lib/boot.mjs)
	'verify-look-math', // pure node, no instance needed
	'verify-style-claim',
	'verify-settings-model',
	'verify-fullscreen-keyboard',
	'verify-fullscreen-usable',
	'verify-keyboard-squish',
	'verify-standalone-fullscreen',
];

const HEAVY = [
	// Each entry burns ≥1 real LLM/TTS/ASR round. Run only what the change
	// under test actually touches (see the reference doc for the matrix).
	'verify-live',
	'verify-third-person',
	'verify-voice',
	'verify-phase3',
	'verify-stream',
	'verify-standalone',
	'verify-nodup',
	'verify-translation-race',
	'verify-inject',
	'verify-unload-cleanup',
	'verify-v11',
	'verify-look-sliders',
	'verify-soak',
	'verify-asr',
];

const arg = process.argv[2] ?? 'light';
let suites;
if (arg === 'light') suites = LIGHT;
else if (arg === 'heavy') suites = HEAVY;
else suites = process.argv.slice(2).map((n) => n.replace(/\.mjs$/, '').replace(/^e2e\//, ''));

if (suites.length === 0) {
	console.error('no suites selected');
	process.exit(2);
}
console.log(`running ${suites.length} suite(s): ${suites.join(', ')}\n`);

const summary = [];
for (const s of suites) {
	console.log(`── ${s} ${'─'.repeat(Math.max(4, 60 - s.length))}`);
	const r = spawnSync('node', [`e2e/${s}.mjs`], { stdio: 'inherit', env: process.env });
	const ok = r.status === 0;
	summary.push({ s, ok, status: r.status });
	console.log(`   → ${ok ? 'PASS' : `FAIL (exit ${r.status})`}\n`);
}

const failed = summary.filter((x) => !x.ok);
console.log('══ summary ' + '═'.repeat(50));
for (const { s, ok, status } of summary) console.log(`  ${ok ? '✓' : '✗'} ${s}${ok ? '' : ` (exit ${status})`}`);
console.log(`${summary.length - failed.length}/${summary.length} suites passed`);
process.exit(failed.length ? 1 : 0);
