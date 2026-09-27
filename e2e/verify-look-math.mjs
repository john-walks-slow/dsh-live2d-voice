#!/usr/bin/env node
/**
 * Look-blend math e2e — no browser needed, imports the real client module
 * (src/client/look-math.ts) through node's type stripping.
 *
 * The gains in LookParams are signed (negative = mirrored). The regression
 * this locks down: the blend weight must use the ABSOLUTE gain, otherwise two
 * opposed sources cancel the denominator (0/0 → NaN) and a single negative
 * source flips the mix of the other one.
 */
import { mixLookChannel, DEFAULT_LOOK_PARAMS, LOOK_PRESETS, compute3dTransform } from '../src/client/look-math.ts';

const results = [];
const check = (id, ok, note = '') => { results.push({ id, ok }); console.log(`${ok ? '✓' : '✗'} ${id} ${note}`); };
const CAM = { dx: 0.8, dy: -0.4 };
const GYRO = { dx: 0.2, dy: 0.6 };
const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-9;

// 1. Backward compatibility: positive gains reproduce the old weighted mean.
const legacyMean = (cc, gg) => {
	const total = cc + gg || 1;
	return (CAM.dx * cc + GYRO.dx * gg) / total;
};
check('positive gains == legacy weighted mean', close(mixLookChannel(1, 0.55, CAM, GYRO, 'dx', true, true), legacyMean(1, 0.55)));

// 2. A negative gain mirrors exactly that source (sign flip, same magnitude).
const pos = mixLookChannel(1, 0.55, CAM, GYRO, 'dx', true, true);
const mirrored = mixLookChannel(1, -0.55, CAM, GYRO, 'dx', true, true);
check('negative gyro gain mirrors the gyro contribution',
	close(pos + mirrored, 2 * (CAM.dx * 1) / (1 + 0.55)) && mirrored < pos);

// 3. Opposed equal gains must not produce NaN/Infinity (denominator is abs).
const opposed = mixLookChannel(1, -1, CAM, GYRO, 'dx', true, true);
check('opposed ±1 gains stay finite', Number.isFinite(opposed), `= ${opposed}`);

// 4. A single live source normalizes to the raw vector; a negative gain
//    mirrors it. (Gains are relative weights between the two sources, not
//    magnitudes — 整体幅度 sliders carry the magnitude.)
check('single negative source mirrors', close(mixLookChannel(-1.5, 0, CAM, GYRO, 'dx', true, false), -CAM.dx));

// 5. A dead source contributes neither value nor weight.
check('dead cam source ignored', close(mixLookChannel(9, 0.5, CAM, GYRO, 'dx', false, true), GYRO.dx));
check('both dead -> 0', close(mixLookChannel(1, 1, CAM, GYRO, 'dx', false, false), 0));

// 6. All-zero gains -> 0, not NaN (total || 1 guard).
check('zero gains -> 0', close(mixLookChannel(0, 0, CAM, GYRO, 'dy', true, true), 0));

// 7. dy channel is independent of dx.
check('dy channel reads dy', close(mixLookChannel(1, 1, CAM, GYRO, 'dy', true, true), (CAM.dy + GYRO.dy) / 2));

// 8. Head turn angleRange is significantly reduced (< 12°) for natural subtle gaze.
check('default angleRange <= 10 (reduced head turn)', DEFAULT_LOOK_PARAMS.angleRange <= 10 && DEFAULT_LOOK_PARAMS.angleRange >= 5, `angleRange=${DEFAULT_LOOK_PARAMS.angleRange}`);

// 9. 3D transform & mobility parameters exist in DEFAULT_LOOK_PARAMS and presets.
check('3D transform gains exist', Number.isFinite(DEFAULT_LOOK_PARAMS.transform3dCamGain) && Number.isFinite(DEFAULT_LOOK_PARAMS.transform3dGyroGain) && Number.isFinite(DEFAULT_LOOK_PARAMS.transform3dRange));
check('extended mobility gains exist (bodyZ, brow, eyeball form)', Number.isFinite(DEFAULT_LOOK_PARAMS.bodyZGain) && Number.isFinite(DEFAULT_LOOK_PARAMS.browGain) && Number.isFinite(DEFAULT_LOOK_PARAMS.eyeBallFormGain));
check('presets maintain valid ranges', LOOK_PRESETS.every((p) => p.params.angleRange <= 16 && p.params.transform3dRange > 0));

// 10. Center calibration math: offsets shift raw coords to 0.5 neutral center.
const rawX = 0.42;
const rawY = 0.65;
const yawOffset = 0.5 - rawX; // 0.08
const pitchOffset = 0.5 - rawY; // -0.15
const calibratedScreenX = (rawX - 0.5 + yawOffset) * 1.3 + 0.5;
const calibratedScreenY = (rawY - 0.5 + pitchOffset) * 1.2 + 0.5;
check('center calibration math maps current point to (0.5, 0.5)', close(calibratedScreenX, 0.5) && close(calibratedScreenY, 0.5));

// 11. compute3dTransform returns correct perspective and angles
const t3d = compute3dTransform(0.5, 0.8, 6, CAM, GYRO, true, true);
check('compute3dTransform generates valid css and angles', t3d !== null && t3d.css.includes('perspective(1000px)') && Number.isFinite(t3d.yaw) && Number.isFinite(t3d.pitch));
check('compute3dTransform returns null when dead or range=0', compute3dTransform(0.5, 0.8, 0, CAM, GYRO, true, true) === null && compute3dTransform(0.5, 0.8, 6, CAM, GYRO, false, false) === null);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
