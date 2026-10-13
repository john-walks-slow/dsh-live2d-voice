/**
 * Pure look-blending math, kept out of mountModel so the rules are testable
 * on their own (e2e/verify-look-math.mjs).
 *
 * Each source is scaled by a non-negative sensitivity multiplier (camera /
 * gyro), the two contributions are added and saturated to ±1, and that
 * normalized look is then scaled by the per-channel amplitude (degrees for
 * head turn and roll, normalized eyeball offset, container fraction for pan).
 * So a slider value IS the physical ceiling: sensitivity only balances the two
 * sources against each other, amplitude only sets how far the character moves.
 */

/** A look vector in the -1..1 normalized space shared by the camera and gyro. */
export interface LookVector {
	dx: number;
	dy: number;
}

/**
 * Combine one channel of the two (possibly lagged) look vectors.
 *
 * @param camGain  sensitivity multiplier of the camera source
 * @param gyroGain sensitivity multiplier of the gyro source
 * @param cam      vector to read for the camera side (eye / head / body lag chain)
 * @param gyro     vector to read for the gyro side
 * @param channel  "dx" (horizontal) or "dy" (vertical)
 * @param camLive  camera source currently delivering input
 * @param gyroLive gyro source currently delivering input
 * @returns signed, normalized -1..1 channel; 0 when nothing is live
 */
export function mixLookChannel(
	camGain: number,
	gyroGain: number,
	cam: LookVector,
	gyro: LookVector,
	channel: "dx" | "dy",
	camLive: boolean,
	gyroLive: boolean,
): number {
	const camPart = camLive ? cam[channel] * camGain : 0;
	const gyroPart = gyroLive ? gyro[channel] * gyroGain : 0;
	return Math.max(-1, Math.min(1, camPart + gyroPart));
}

export interface LookParams {
	/** Camera tracking sensitivity multiplier (0 = off, 1 = balanced). */
	camSensitivity: number;
	/** Gyroscope tilt sensitivity multiplier (0 = off, 1 = balanced). */
	gyroSensitivity: number;
	/** Head + body turn at full input, in degrees. */
	angleAmp: number;
	/** Eyeball offset at full input (ParamEyeBallX/Y, -1..1). */
	eyeAmp: number;
	/** Head roll at full input (ParamAngleZ), in degrees. */
	rollAmp: number;
	/** Stage pan at full input, as a fraction of the container width / height. */
	panAmp: number;
	/** Body roll (ParamBodyAngleZ) coupling with the head roll, as a ratio of it. */
	bodyZGain: number;
}

export const DEFAULT_LOOK_PARAMS: LookParams = {
	camSensitivity: 1.0,
	gyroSensitivity: 1.0,
	angleAmp: 20,
	eyeAmp: 0.7,
	rollAmp: 6,
	panAmp: 0.005,
	bodyZGain: 0.4,
};

/** One-tap look presets for the settings popover. */
export const LOOK_PRESETS: ReadonlyArray<{ id: string; label: string; params: LookParams }> = [
	{
		id: "subtle",
		label: "柔和",
		params: {
			...DEFAULT_LOOK_PARAMS,
			angleAmp: 12,
			eyeAmp: 0.5,
			rollAmp: 4,
			panAmp: 0.003,
			bodyZGain: 0.2,
		},
	},
	{ id: "standard", label: "标准", params: { ...DEFAULT_LOOK_PARAMS } },
	{
		id: "vivid",
		label: "灵敏",
		params: {
			...DEFAULT_LOOK_PARAMS,
			angleAmp: 28,
			eyeAmp: 0.9,
			rollAmp: 10,
			panAmp: 0.012,
			bodyZGain: 0.6,
		},
	},
];
