/**
 * Sentence segmentation for streaming TTS.
 *
 * The llm/stream tap feeds text deltas in as they arrive; the buffer emits
 * complete sentences as soon as a terminator (。！？!?…\n) is seen so speech
 * starts while the model is still writing. Long terminator-free runs are cut
 * at a pause punctuation near the soft limit (or hard-cut at the limit).
 */

/** Characters that end a sentence. */
const TERMINATOR = /[。！？!?…\n]/;
/** Pause punctuation preferred over a hard cut at the soft limit. */
const PAUSES = ["，", ",", "、", "；", ";", "：", " ", ")", "）"];

/** Strip known emotion tags from a text and collect them in order. */
export function extractEmotionTags(text: string, vocabulary: ReadonlySet<string>): { clean: string; emotions: string[] } {
	if (!text.includes("[")) return { clean: text, emotions: [] };
	const emotions: string[] = [];
	const clean = text.replace(/\[([a-zA-Z][a-zA-Z0-9_-]*)\]/g, (whole, tag: string) => {
		if (!vocabulary.has(tag)) return whole;
		emotions.push(tag);
		return "";
	});
	return { clean, emotions };
}

/** Strip motion tags [motion:name] from a text and collect them in order. */
export function extractMotionTags(text: string): { clean: string; motions: string[] } {
	if (!text.includes("[motion:")) return { clean: text, motions: [] };
	const motions: string[] = [];
	const clean = text.replace(/\[motion:([a-zA-Z0-9_-]+)\]/gi, (_whole, tag: string) => {
		motions.push(tag);
		return "";
	});
	return { clean, motions };
}

/**
 * Accumulates text deltas and yields complete sentences.
 * `push` returns every sentence that became complete; `flush` drains the
 * remainder once the stream is finished.
 */
export class SentenceBuffer {
	private buffer = "";

	constructor(private readonly softLimit = 120) {}

	push(text: string): string[] {
		this.buffer += text;
		const out: string[] = [];
		for (;;) {
			const sentence = this.cutOne();
			if (sentence === undefined) break;
			if (sentence.trim()) out.push(sentence);
		}
		return out;
	}

	/** Drain whatever remains (no terminator needed). */
	flush(): string[] {
		const rest = this.buffer;
		this.buffer = "";
		return rest.trim() ? [rest] : [];
	}

	/** Remove and return the next complete sentence, or undefined if none yet. */
	private cutOne(): string | undefined {
		const match = TERMINATOR.exec(this.buffer);
		if (match?.index !== undefined) {
			// Consume the full terminator run ("！！", "……") plus one closing quote.
			let end = match.index + 1;
			while (end < this.buffer.length && TERMINATOR.test(this.buffer[end])) end += 1;
			if (end < this.buffer.length && "」』”\"()）)".includes(this.buffer[end])) end += 1;
			const sentence = this.buffer.slice(0, end);
			this.buffer = this.buffer.slice(end);
			return sentence;
		}
		if (this.buffer.length < this.softLimit) return undefined;
		// Prefer cutting just after a pause in the back half of the buffer.
		const half = Math.floor(this.softLimit / 2);
		let cutAt = -1;
		for (const pause of PAUSES) {
			const index = this.buffer.lastIndexOf(pause);
			if (index > Math.max(cutAt, half)) cutAt = index;
		}
		const take = cutAt > 0 ? cutAt + 1 : this.softLimit;
		const sentence = this.buffer.slice(0, take);
		this.buffer = this.buffer.slice(take);
		return sentence;
	}
}

// ---------- whole-utterance translation split ----------

/** Characters that make an acceptable cut point for a subtitle chunk. */
const CUT_BOUNDARIES = "。！？!?．.，、,;；：: …— ";

/**
 * Cut a whole-utterance translation back onto the original subtitle lines,
 * proportionally to each line's share of the original text (its weight).
 * Sentence boundaries shift and merge in translation, so an index-based
 * sentence mapping strands lines without a translation; proportional cuts
 * with punctuation snapping keep every line covered. Pieces are trimmed;
 * a line only receives an empty piece when the translation is too short to
 * divide (fewer characters than lines).
 */
export function splitByWeight(translated: string, weights: number[]): string[] {
	const n = weights.length;
	if (n === 0) return [];
	const total = weights.reduce((a, b) => a + b, 0);
	if (total === 0 || translated.length === 0) {
		const whole = new Array<string>(n).fill("");
		whole[0] = translated;
		return whole;
	}
	// Raw proportional cut points, kept strictly increasing (clamped) so no
	// two cuts collide while the translation is long enough to divide.
	const cuts: number[] = [0];
	for (let i = 1; i < n; i++) {
		const cumulative = weights.slice(0, i).reduce((a, b) => a + b, 0);
		const raw = Math.round((translated.length * cumulative) / total);
		cuts.push(Math.min(translated.length, Math.max(cuts[i - 1] + 1, raw)));
	}
	cuts.push(translated.length);
	// Snap interior cuts to nearby punctuation (never crossing a neighbor).
	// bestDist starts at Infinity — the raw proportional cut only survives
	// when no boundary lies inside the window.
	const snapped = cuts.slice();
	for (let i = 1; i < n; i++) {
		let best = snapped[i];
		let bestDist = Infinity;
		const lo = Math.max(snapped[i - 1] + 1, cuts[i] - 12);
		const hi = Math.min(snapped[i + 1] - 1, cuts[i] + 12);
		for (let pos = lo; pos <= hi; pos++) {
			if (CUT_BOUNDARIES.includes(translated[pos - 1] ?? "")) {
				const dist = Math.abs(pos - cuts[i]);
				if (dist < bestDist) {
					best = pos;
					bestDist = dist;
				}
			}
		}
		snapped[i] = best;
	}
	const pieces: string[] = [];
	for (let i = 0; i < n; i++) pieces.push(translated.slice(snapped[i], snapped[i + 1]).trim());
	return pieces;
}
