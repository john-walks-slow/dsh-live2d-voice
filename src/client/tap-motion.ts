/**
 * Smart motion resolver for tap and touch interactions.
 *
 * Implements a cascading heuristic that maps a hit area (or generic avatar tap)
 * to an available motion definition on the model:
 *
 * 1. Area-specific group name: `Tap<Area>`, `Tap_<Area>`, `touch_<area>`, `<area>`
 * 2. Area-specific motion file: files matching the area keywords (e.g. `head`, `body`)
 * 3. Generic touch group: `Tap`, `TapBody`, `touch_body`, `touch`, `touch_special`
 * 4. Generic touch file: files matching `touch`, `tap`, `click`, `main_` (excluding idle)
 * 5. Non-idle pool: any expressive/reaction motion excluding idle/wait/loop
 * 6. Fallback: any available motion definition
 */

export interface ResolvedMotion {
	group: string;
	index: number;
	area: string | null;
	strategy: "area-group" | "area-file" | "generic-group" | "generic-file" | "non-idle" | "fallback";
}

export type MotionDefinitions = Record<string, Array<Record<string, unknown>>>;

function getFileName(item: Record<string, unknown> | undefined): string {
	if (!item) return "";
	const f = item.File ?? item.file;
	return typeof f === "string" ? f.toLowerCase() : "";
}

/**
 * Resolve the best answering motion for a tap on the model.
 */
export function resolveTapMotion(
	definitions: MotionDefinitions | null | undefined,
	area: string | null = null,
): ResolvedMotion | null {
	if (!definitions || typeof definitions !== "object") return null;
	const groups = Object.keys(definitions);
	if (groups.length === 0) return null;

	const byName = (want: string): string | null =>
		groups.find((g) => g.toLowerCase() === want.toLowerCase()) ?? null;

	// 1. Area-specific group name
	if (area) {
		const directGroup =
			byName(`Tap${area}`) ||
			byName(`Tap_${area}`) ||
			byName(`touch_${area}`) ||
			byName(`touch${area}`) ||
			byName(area);
		if (directGroup && (definitions[directGroup]?.length ?? 0) > 0) {
			const list = definitions[directGroup]!;
			return {
				group: directGroup,
				index: Math.floor(Math.random() * list.length),
				area,
				strategy: "area-group",
			};
		}
	}

	// 2. Area-specific motion file (essential for ripped rigs bundling motions in "" or single groups)
	if (area) {
		const areaLower = area.toLowerCase();
		const keywords = areaLower.includes("head")
			? ["head", "atama", "face"]
			: areaLower.includes("body")
			? ["body", "karada", "main_"]
			: [areaLower];

		const areaFileMatches: Array<{ group: string; index: number }> = [];
		for (const g of groups) {
			const list = definitions[g] ?? [];
			for (let i = 0; i < list.length; i++) {
				const f = getFileName(list[i]);
				if (keywords.some((k) => f.includes(k))) {
					areaFileMatches.push({ group: g, index: i });
				}
			}
		}
		if (areaFileMatches.length > 0) {
			const picked = areaFileMatches[Math.floor(Math.random() * areaFileMatches.length)]!;
			return {
				group: picked.group,
				index: picked.index,
				area,
				strategy: "area-file",
			};
		}
	}

	// 3. Generic touch group
	const genericGroup =
		byName("Tap") ||
		byName("TapBody") ||
		byName("touch_body") ||
		byName("touch") ||
		byName("touch_special");
	if (genericGroup && (definitions[genericGroup]?.length ?? 0) > 0) {
		const list = definitions[genericGroup]!;
		return {
			group: genericGroup,
			index: Math.floor(Math.random() * list.length),
			area,
			strategy: "generic-group",
		};
	}

	// 4. Generic touch file keywords (excluding idle clips)
	const genericFileMatches: Array<{ group: string; index: number }> = [];
	for (const g of groups) {
		const list = definitions[g] ?? [];
		for (let i = 0; i < list.length; i++) {
			const f = getFileName(list[i]);
			const isTouchLike = f.includes("touch") || f.includes("tap") || f.includes("click") || f.includes("main_");
			const isIdleLike = f.includes("idle") || f.includes("wait") || f.includes("daiji");
			if (isTouchLike && !isIdleLike) {
				genericFileMatches.push({ group: g, index: i });
			}
		}
	}
	if (genericFileMatches.length > 0) {
		const picked = genericFileMatches[Math.floor(Math.random() * genericFileMatches.length)]!;
		return {
			group: picked.group,
			index: picked.index,
			area,
			strategy: "generic-file",
		};
	}

	// 5. Expressive / non-idle clips (reactions, emotions, animations)
	const nonIdleMatches: Array<{ group: string; index: number }> = [];
	for (const g of groups) {
		const list = definitions[g] ?? [];
		for (let i = 0; i < list.length; i++) {
			const f = getFileName(list[i]);
			const isIdleLike = f.includes("idle") || f.includes("wait") || f.includes("daiji") || g.toLowerCase() === "idle";
			if (!isIdleLike) {
				nonIdleMatches.push({ group: g, index: i });
			}
		}
	}
	if (nonIdleMatches.length > 0) {
		const picked = nonIdleMatches[Math.floor(Math.random() * nonIdleMatches.length)]!;
		return {
			group: picked.group,
			index: picked.index,
			area,
			strategy: "non-idle",
		};
	}

	// 6. Final fallback: any non-empty group
	for (const g of groups) {
		const list = definitions[g] ?? [];
		if (list.length > 0) {
			return {
				group: g,
				index: 0,
				area,
				strategy: "fallback",
			};
		}
	}

	return null;
}
