/**
 * Pure look-blending math, kept out of mountModel so the rules are testable
 * on their own (e2e/verify-look-math.mjs).
 *
 * Every *gain* in LookParams is a signed amplitude multiplier for that source:
 * a negative gain mirrors the channel (look away from the user, lean the head
 * the other way, parallax against the input), 0 switches that source off, and
 * the response is linear — 0.05 drives a tenth of what 0.5 does, all the way
 * down to 0.005. The live sources add up and the sum saturates at ±1, so the
 * 整体幅度 sliders (angleRange / rollRange / panRange) stay the hard ceiling
 * and toggling a second source on can never blow past the calibrated range.
 */

/** A look vector in the -1..1 normalized space shared by the camera and gyro. */
export interface LookVector {
	dx: number;
	dy: number;
}

/**
 * Combine one channel of the two (possibly lagged) look vectors.
 *
 * @param camGain  signed amplitude of the camera source
 * @param gyroGain signed amplitude of the gyro source
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
	camPanGain: number;
	/** Head + body turn (ParamAngleX/Y, ParamBodyAngleX/Y) amplitude from the camera. */
	camAngleGain: number;
	/** Head roll (ParamAngleZ, the 3D tilt) gain from the camera. Signed: negative mirrors the tilt. */
	camRollGain: number;
	/** Eyeball (ParamEyeBallX/Y) amplitude from the camera — separate from the head so the gaze can lead or trail the turn. */
	camEyeGain: number;
	gyroPanGain: number;
	gyroAngleGain: number;
	gyroRollGain: number;
	/** Eyeball amplitude from the gyroscope. */
	gyroEyeGain: number;
	panRange: number;
	angleRange: number;
	rollRange: number;
	/** Body roll (ParamBodyAngleZ) coupling gain with head roll. */
	bodyZGain: number;
}

export const DEFAULT_LOOK_PARAMS: LookParams = {
	camPanGain: -2,
	camAngleGain: 0.6,
	camRollGain: 1.0,
	camEyeGain: 0.4,
	gyroPanGain: -2,
	gyroAngleGain: 0.5,
	gyroRollGain: 1.0,
	gyroEyeGain: 0.4,
	panRange: 0.10,
	angleRange: 8,
	rollRange: 5,
	bodyZGain: 0.4,
};

/** One-tap look presets for the settings popover. */
export const LOOK_PRESETS: ReadonlyArray<{ id: string; label: string; params: LookParams }> = [
	{
		id: "subtle",
		label: "柔和",
		params: {
			camPanGain: -1.2,
			camAngleGain: 0.3,
			camRollGain: 0.5,
			camEyeGain: 0.2,
			gyroPanGain: -1.2,
			gyroAngleGain: 0.25,
			gyroRollGain: 0.5,
			gyroEyeGain: 0.2,
			panRange: 0.06,
			angleRange: 5,
			rollRange: 3,
			bodyZGain: 0.2,
		},
	},
	{ id: "standard", label: "标准", params: { ...DEFAULT_LOOK_PARAMS } },
	{
		id: "vivid",
		label: "灵敏",
		params: {
			camPanGain: -3,
			camAngleGain: 1.0,
			camRollGain: 1.5,
			camEyeGain: 0.8,
			gyroPanGain: -3,
			gyroAngleGain: 0.8,
			gyroRollGain: 1.5,
			gyroEyeGain: 0.7,
			panRange: 0.16,
			angleRange: 14,
			rollRange: 8,
			bodyZGain: 0.6,
		},
	},
];
