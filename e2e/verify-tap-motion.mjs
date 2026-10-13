#!/usr/bin/env node
/**
 * Tap-motion heuristic cascade test — tests both synthetic rigs and
 * all real models in /root/.dsh/live2d-voice-models/.
 */
import { resolveTapMotion } from '../src/client/tap-motion.ts';
import fs from 'node:fs';
import path from 'node:path';

const results = [];
const check = (id, ok, note = '') => {
	results.push({ id, ok });
	console.log(`${ok ? '✓' : '✗'} ${id} ${note}`);
};

// 1. Synthetic tests
const rigStandard = {
	Idle: [{ File: 'idle.motion3.json' }],
	TapHead: [{ File: 'tap_head.motion3.json' }],
	TapBody: [{ File: 'tap_body.motion3.json' }],
};
const resHead = resolveTapMotion(rigStandard, 'Head');
check('1. Area-group matches TapHead', resHead?.group === 'TapHead' && resHead?.strategy === 'area-group');

const resBody = resolveTapMotion(rigStandard, 'Body');
check('2. Area-group matches TapBody', resBody?.group === 'TapBody' && resBody?.strategy === 'area-group');

// 2. Ripped rig with all motions under ""
const rigBundled = {
	'': [
		{ File: 'motions/idle.motion3.json' },
		{ File: 'motions/touch_head.motion3.json' },
		{ File: 'motions/touch_body.motion3.json' },
		{ File: 'motions/wedding.motion3.json' },
	],
};
const resBundledHead = resolveTapMotion(rigBundled, 'Head');
check('3. Bundled rig matches touch_head by filename', resBundledHead?.group === '' && resBundledHead?.index === 1 && resBundledHead?.strategy === 'area-file');

const resBundledBody = resolveTapMotion(rigBundled, 'Body');
check('4. Bundled rig matches touch_body by filename', resBundledBody?.group === '' && resBundledBody?.index === 2 && resBundledBody?.strategy === 'area-file');

const resBundledGeneric = resolveTapMotion(rigBundled, null);
check('5. Bundled rig matches generic touch file when area is null', resBundledGeneric?.group === '' && [1, 2].includes(resBundledGeneric?.index) && resBundledGeneric?.strategy === 'generic-file');

// 3. Rig with only expressions/emotions (e.g. KonoSuba)
const rigEmotions = {
	'': [
		{ File: 'motions/idle.motion3.json' },
		{ File: 'motions/00_Happy_01.motion3.json' },
		{ File: 'motions/00_Anger_01.motion3.json' },
	],
};
const resEmotion = resolveTapMotion(rigEmotions, null);
check('6. Non-idle emotion chosen over idle', resEmotion?.group === '' && [1, 2].includes(resEmotion?.index) && resEmotion?.strategy === 'non-idle');

// 4. Rig with only idle
const rigIdleOnly = {
	'': [{ File: 'motions/idle.motion3.json' }],
};
const resIdle = resolveTapMotion(rigIdleOnly, null);
check('7. Idle fallback works when no other motion exists', resIdle?.group === '' && resIdle?.index === 0 && resIdle?.strategy === 'fallback');

// 5. Test real models in the repository
const baseDir = '/root/.dsh/live2d-voice-models';
if (fs.existsSync(baseDir)) {
	let total = 0;
	let resolved = 0;
	function walk(dir) {
		for (const f of fs.readdirSync(dir)) {
			const p = path.join(dir, f);
			if (fs.statSync(p).isDirectory()) walk(p);
			else if (f.endsWith('.model3.json') || f.endsWith('.model.json')) {
				total++;
				try {
					const j = JSON.parse(fs.readFileSync(p, 'utf8'));
					const defs = j.Motions || j.motions || j.FileReferences?.Motions || {};
					const match = resolveTapMotion(defs, 'Head') || resolveTapMotion(defs, 'Body') || resolveTapMotion(defs, null);
					if (match) resolved++;
				} catch {}
			}
		}
	}
	walk(baseDir);
	check(`8. Real model repository: ${resolved}/${total} models resolved`, resolved === total && total > 0, `(${resolved}/${total})`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
	console.error(`\nFailed ${failed.length} checks.`);
	process.exit(1);
} else {
	console.log(`\nAll ${results.length} checks passed.`);
}
