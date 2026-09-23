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
