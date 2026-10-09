#!/usr/bin/env node
/**
 * Look-blend math e2e — no browser needed, imports the real client module
 * (src/client/look-math.ts) through node's type stripping.
 *
 * Regression locked down here: gains used to be *normalized blend weights*,
 * so with a single live source the magnitude cancelled out
 * ((dx · g) / |g| = dx · sign(g)) and 0.005 was indistinguishable from 1.0.
 * They are now signed amplitude multipliers — small values scale the motion
 * down linearly, and two live sources add (saturating at ±1).
 */
import { mixLookChannel, DEFAULT_LOOK_PARAMS, LOOK_PRESETS } from '../src/client/look-math.ts';

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };
const CAM = { dx: 0.8, dy: -0.4 };
const GYRO = { dx: 0.2, dy: 0.6 };
const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-9;

// 1. THE regression: a single live source scales linearly with its gain.
check('tiny single-source gains scale linearly (0.005 ≠ 0.1)',
	close(mixLookChannel(0.005, 0, CAM, GYRO, 'dx', true, false), CAM.dx * 0.005) &&
	close(mixLookChannel(0.1, 0, CAM, GYRO, 'dx', true, false), CAM.dx * 0.1) &&
	!close(mixLookChannel(0.005, 0, CAM, GYRO, 'dx', true, false), mixLookChannel(0.1, 0, CAM, GYRO, 'dx', true, false)));
check('gain 1 on a single source is pass-through', close(mixLookChannel(1, 0, CAM, GYRO, 'dx', true, false), CAM.dx));

// 2. A negative gain mirrors exactly that source's contribution.
check('negative single-source gain mirrors', close(mixLookChannel(-1, 0, CAM, GYRO, 'dx', true, false), -CAM.dx));
check('negative gyro gain mirrors only the gyro part',
	close(mixLookChannel(0.5, -0.5, CAM, GYRO, 'dx', true, true), CAM.dx * 0.5 - GYRO.dx * 0.5));

// 3. Two live sources add; the sum saturates so the range sliders stay the ceiling.
check('two live sources add', close(mixLookChannel(0.5, 0.25, CAM, GYRO, 'dx', true, true), CAM.dx * 0.5 + GYRO.dx * 0.25));
check('sum saturates at ±1',
	mixLookChannel(2, 2, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }, 'dx', true, true) === 1 &&
	mixLookChannel(-2, -2, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }, 'dx', true, true) === -1);

// 4. A dead source contributes neither value nor weight.
check('dead cam source ignored', close(mixLookChannel(9, 0.5, CAM, GYRO, 'dx', false, true), GYRO.dx * 0.5));
check('both dead -> 0', close(mixLookChannel(1, 1, CAM, GYRO, 'dx', false, false), 0));

// 5. All-zero gains -> 0, not NaN.
check('zero gains -> 0', close(mixLookChannel(0, 0, CAM, GYRO, 'dy', true, true), 0));

// 6. dy channel is independent of dx.
check('dy channel reads dy', close(mixLookChannel(1, 1, CAM, GYRO, 'dy', true, true), CAM.dy + GYRO.dy));

// 7. Defaults: subtle head turn, -2 pan, head/eye split, removals.
check('default angleRange stays subtle (<= 10°, >= 5°)', DEFAULT_LOOK_PARAMS.angleRange <= 10 && DEFAULT_LOOK_PARAMS.angleRange >= 5, `angleRange=${DEFAULT_LOOK_PARAMS.angleRange}`);
check('both pan gains default to -2', DEFAULT_LOOK_PARAMS.camPanGain === -2 && DEFAULT_LOOK_PARAMS.gyroPanGain === -2);
check('head and eye carry separate gain pairs',
	['camAngleGain', 'camEyeGain', 'gyroAngleGain', 'gyroEyeGain', 'camRollGain', 'gyroRollGain', 'bodyZGain'].every((k) => Number.isFinite(DEFAULT_LOOK_PARAMS[k])));
check('removed channels are gone (3D transform / brow / eyeball form)',
	['transform3dCamGain', 'transform3dGyroGain', 'transform3dRange', 'browGain', 'eyeBallFormGain'].every((k) => !(k in DEFAULT_LOOK_PARAMS)));
check('presets carry exactly the live parameter set',
	LOOK_PRESETS.every((p) => Object.keys(p.params).sort().join() === Object.keys(DEFAULT_LOOK_PARAMS).sort().join()));
check('presets stay in range', LOOK_PRESETS.every((p) => p.params.angleRange <= 16 && Math.abs(p.params.camPanGain) <= 3 && Math.abs(p.params.gyroPanGain) <= 3));

// 8. Center calibration math: offsets shift raw coords to 0.5 neutral center.
const rawX = 0.42;
const rawY = 0.65;
const yawOffset = 0.5 - rawX; // 0.08
const pitchOffset = 0.5 - rawY; // -0.15
const calibratedScreenX = (rawX - 0.5 + yawOffset) * 1.3 + 0.5;
const calibratedScreenY = (rawY - 0.5 + pitchOffset) * 1.2 + 0.5;
check('center calibration math maps current point to (0.5, 0.5)', close(calibratedScreenX, 0.5) && close(calibratedScreenY, 0.5));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
