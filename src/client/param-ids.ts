/**
 * Standard-parameter id resolution.
 *
 * The plugin drives a thin standard layer — head angles, body angles, eye
 * ball, brows, mouth. Which *spelling* a model uses is NOT derivable from the
 * file format: many `.moc3` rigs (legacy ports, game assets) keep the Cubism
 * 2.1 UPPER_SNAKE ids, and both cores are case-sensitive, so writing the
 * guessed spelling is a silent no-op (the model just never looks at you).
 *
 * So: probe the model's own parameter table once per load and pick the
 * spelling it actually declares. Only the two official spellings of the same
 * standard id are considered — generic short names (`ParamX`, `ParamEyeX`,
 * game-specific rigs) are deliberately out of scope: the collision risk
 * outweighs the handful of models they would unlock.
 */

/** The look/mouth ids the renderer drives, in camelCase (Cubism 3+) spelling. */
export interface LookParamIds {
	angleX: string;
	angleY: string;
	angleZ: string;
	bodyX: string;
	bodyY: string;
	bodyZ: string;
	eyeX: string;
	eyeY: string;
	eyeBallForm: string;
	browLY: string;
	browRY: string;
}

export interface ResolvedParamIds {
	mouth: string;
	look: LookParamIds;
}

/** [camelCase (Cubism 3+), UPPER_SNAKE (Cubism 2.1)] for every driven id. */
export const STANDARD_PARAM_PAIRS: Record<keyof LookParamIds | "mouth", readonly [string, string]> = {
	// Reserved slots: the standard mapping is kept complete (and mirrored by the
	// model-library health checker), but the current look pipeline only writes
	// head/body/eye + mouth — brow and eyeball-form are not driven right now.
	mouth: ["ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y"],
	angleX: ["ParamAngleX", "PARAM_ANGLE_X"],
	angleY: ["ParamAngleY", "PARAM_ANGLE_Y"],
	angleZ: ["ParamAngleZ", "PARAM_ANGLE_Z"],
	bodyX: ["ParamBodyAngleX", "PARAM_BODY_ANGLE_X"],
	bodyY: ["ParamBodyAngleY", "PARAM_BODY_ANGLE_Y"],
	bodyZ: ["ParamBodyAngleZ", "PARAM_BODY_ANGLE_Z"],
	eyeX: ["ParamEyeBallX", "PARAM_EYE_BALL_X"],
	eyeY: ["ParamEyeBallY", "PARAM_EYE_BALL_Y"],
	eyeBallForm: ["ParamEyeBallForm", "PARAM_EYE_BALL_FORM"],
	browLY: ["ParamBrowLY", "PARAM_BROW_L_Y"],
	browRY: ["ParamBrowRY", "PARAM_BROW_R_Y"],
};

/**
 * Pick the spelling the model declares. When the model declares both, the
 * camelCase one wins (unchanged behaviour for every model that worked
 * before); when it declares neither, the format default wins and the write
 * stays a no-op exactly like today — no new fallbacks, no silent guessing.
 */
export function resolveParamId(
	pair: readonly [string, string],
	kind: "moc2" | "moc3",
	has: (id: string) => boolean,
): string {
	if (has(pair[0])) return pair[0];
	if (has(pair[1])) return pair[1];
	return kind === "moc2" ? pair[1] : pair[0];
}

/** Resolve every driven id against one model's parameter table. */
export function resolveParamIds(kind: "moc2" | "moc3", has: (id: string) => boolean): ResolvedParamIds {
	const look = {} as LookParamIds;
	for (const key of Object.keys(STANDARD_PARAM_PAIRS) as Array<keyof LookParamIds | "mouth">) {
		if (key === "mouth") continue;
		look[key] = resolveParamId(STANDARD_PARAM_PAIRS[key], kind, has);
	}
	return { mouth: resolveParamId(STANDARD_PARAM_PAIRS.mouth, kind, has), look };
}
