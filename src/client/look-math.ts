/**
 * Pure look-blending math, kept out of mountModel so the sign rules are
 * testable on their own (e2e/verify-look-math.mjs).
 *
 * Every *gain* in LookParams is signed: a negative gain mirrors that source
 * (look away from the user, lean the head the other way, parallax against
 * the input). The blend weight is therefore the *absolute* gain — otherwise
 * two opposed signs would cancel the denominator and either blow up
 * (0/0) or invert the mix of the surviving source.
 */

/** A look vector in the -1..1 normalized space shared by the camera and gyro. */
export interface LookVector {
	dx: number;
	dy: number;
}

/**
 * Blend one channel of two (possibly lagged) look vectors by their gains.
 *
 * @param camGain  signed gain of the camera source
 * @param gyroGain signed gain of the gyro source
 * @param cam      vector to read for the camera side (eye / head / body lag chain)
 * @param gyro     vector to read for the gyro side
 * @param channel  "dx" (horizontal) or "dy" (vertical)
 * @param camLive  camera source currently delivering input
 * @param gyroLive gyro source currently delivering input
 * @returns signed, normalized -1..1-ish channel; 0 when nothing is live
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
	const wc = camLive ? Math.abs(camGain) : 0;
	const wg = gyroLive ? Math.abs(gyroGain) : 0;
	const total = wc + wg || 1;
	return ((camLive ? cam[channel] * camGain : 0) + (gyroLive ? gyro[channel] * gyroGain : 0)) / total;
}

export interface LookParams {
	camPanGain: number;
	camAngleGain: number;
	/** Head roll (ParamAngleZ, the 3D tilt) gain from the camera. Signed: negative mirrors the tilt. */
	camRollGain: number;
	gyroPanGain: number;
	gyroAngleGain: number;
	gyroRollGain: number;
	panRange: number;
	angleRange: number;
	rollRange: number;
	/** 3D transform (CSS perspective + rotateX/Y/Z) gain from camera gaze. */
	transform3dCamGain: number;
	/** 3D transform gain from gyroscope tilt. */
	transform3dGyroGain: number;
	/** Maximum 3D transform rotation angle (degrees). */
	transform3dRange: number;
	/** Body roll (ParamBodyAngleZ) coupling gain with head roll. */
	bodyZGain: number;
	/** Eyebrow vertical movement (ParamBrowLY / ParamBrowRY) with vertical gaze. */
	browGain: number;
	/** Eyeball form (ParamEyeBallForm) distortion gain with gaze angle. */
	eyeBallFormGain: number;
}

export const DEFAULT_LOOK_PARAMS: LookParams = {
	camPanGain: 0.20,
	camAngleGain: 1.0,
	camRollGain: 1.0,
	gyroPanGain: 0.45,
	gyroAngleGain: 0.55,
	gyroRollGain: 1.0,
	panRange: 0.10,
	angleRange: 8,
	rollRange: 5,
	transform3dCamGain: 0.5,
	transform3dGyroGain: 0.8,
	transform3dRange: 6,
	bodyZGain: 0.4,
	browGain: 0.25,
	eyeBallFormGain: 0,
};

/** One-tap look presets for the settings popover. */
export const LOOK_PRESETS: ReadonlyArray<{ id: string; label: string; params: LookParams }> = [
	{
		id: "subtle",
		label: "柔和",
		params: {
			camPanGain: 0.12,
			camAngleGain: 0.6,
			camRollGain: 0.6,
			gyroPanGain: 0.25,
			gyroAngleGain: 0.35,
			gyroRollGain: 0.6,
			panRange: 0.06,
			angleRange: 5,
			rollRange: 3,
			transform3dCamGain: 0.3,
			transform3dGyroGain: 0.5,
			transform3dRange: 4,
			bodyZGain: 0.2,
			browGain: 0.15,
			eyeBallFormGain: 0,
		},
	},
	{ id: "standard", label: "标准", params: { ...DEFAULT_LOOK_PARAMS } },
	{
		id: "vivid",
		label: "灵敏",
		params: {
			camPanGain: 0.3,
			camAngleGain: 1.4,
			camRollGain: 1.4,
			gyroPanGain: 0.6,
			gyroAngleGain: 0.8,
			gyroRollGain: 1.4,
			panRange: 0.16,
			angleRange: 14,
			rollRange: 8,
			transform3dCamGain: 0.8,
			transform3dGyroGain: 1.2,
			transform3dRange: 10,
			bodyZGain: 0.6,
			browGain: 0.35,
			eyeBallFormGain: 0.15,
		},
	},
];

export interface Transform3dResult {
	yaw: number;
	pitch: number;
	roll: number;
	css: string;
}

export function compute3dTransform(
	camGain: number,
	gyroGain: number,
	range: number,
	cam: LookVector,
	gyro: LookVector,
	camLive: boolean,
	gyroLive: boolean,
): Transform3dResult | null {
	if (range === 0 || (camGain === 0 && gyroGain === 0) || (!camLive && !gyroLive)) {
		return null;
	}
	const yaw = mixLookChannel(camGain, gyroGain, cam, gyro, "dx", camLive, gyroLive) * range;
	const pitch = -mixLookChannel(camGain, gyroGain, cam, gyro, "dy", camLive, gyroLive) * range;
	const roll = mixLookChannel(camGain, gyroGain, cam, gyro, "dx", camLive, gyroLive) * (range * 0.4);
	const css = `perspective(1000px) rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg) rotateZ(${roll.toFixed(2)}deg)`;
	return { yaw, pitch, roll, css };
}
