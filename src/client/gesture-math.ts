/**
 * Pure gesture-recognition math for touch mode, kept out of mountModel so the
 * rules are table-testable on their own (see e2e/verify-touch-mode.mjs).
 *
 * A model's own gesture vocabulary lives in its motion groups: `FlickUp` /
 * `FlickDown` / `FlickLeft` / `FlickRight` for directional swipes, bare
 * `Flick` when the rig only ships one swipe clip, and `Shake` when the rig
 * predates directional flicks. We never invent groups — a model that ships
 * none simply has no gesture motions to trigger.
 */

export type SwipeDirection = "Up" | "Down" | "Left" | "Right";

/** Minimum travel for a press to count as a swipe rather than a tap. */
export const SWIPE_MIN_DISTANCE_PX = 40;
/** A swipe is a quick gesture: longer presses are drags. */
export const SWIPE_MAX_DURATION_MS = 400;
/** Guards against slow drifts that happen to cover the distance. */
export const SWIPE_MIN_SPEED_PX_PER_MS = 0.5;

export interface SwipeVector {
	dx: number;
	dy: number;
	durationMs: number;
}

/**
 * Which direction a swipe points. The dominant axis always wins, so a
 * diagonal swipe is a normal swipe — `Shake` is a fallback for rigs without
 * directional groups, never a "diagonal" bucket.
 */
export function swipeDirection(dx: number, dy: number): SwipeDirection {
	if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "Left" : "Right";
	return dy < 0 ? "Up" : "Down";
}

/** Distance + speed + duration gate for a swipe. */
export function isSwipe({ dx, dy, durationMs }: SwipeVector): boolean {
	const distance = Math.hypot(dx, dy);
	if (distance < SWIPE_MIN_DISTANCE_PX) return false;
	if (durationMs <= 0 || durationMs > SWIPE_MAX_DURATION_MS) return false;
	return distance / durationMs >= SWIPE_MIN_SPEED_PX_PER_MS;
}

/**
 * Pick the motion group answering a swipe, in the model's own terms:
 * `Flick<Direction>` → `Flick` → `Shake` → null. Matching is
 * case-insensitive because ripped rigs spell groups inconsistently.
 */
export function resolveGestureGroup(groups: readonly string[], direction: SwipeDirection): string | null {
	const byName = (want: string) => groups.find((g) => g.toLowerCase() === want.toLowerCase()) ?? null;
	return byName(`Flick${direction}`) ?? byName("Flick") ?? byName("Shake");
}
