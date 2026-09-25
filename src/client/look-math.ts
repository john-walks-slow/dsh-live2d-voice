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
