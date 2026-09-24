/**
 * The llm/stream tap: sentence the assistant stream, drive expressions and
 * subtitles, and synthesize speech sentence-by-sentence while the model is
 * still writing. Assistant subtitles are additionally translated into the
 * configured subtitle language through one-shot llm calls that reuse the
 * session's own provider/model (never tapped back: they carry no sessionId
 * and no purpose).
 *
 * Only sessions with a live SSE listener (an open Live2D view) are tapped;
 * every other stream passes through untouched — except recently-exited
 * sessions, whose completion clears the exit reminder (see system-prompt.ts).
 *
 * The TTS queue is decoupled from the generator: once the model stream ends
 * the generator returns immediately (the agent turn settles without waiting
 * for audio synthesis) and a background drain emits audio-end/speech-end when
 * the queue settles. A new stream for the same session aborts the previous
 * utterance's pending TTS so audio never overlaps.
 */

import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { SentenceBuffer, extractEmotionTags } from "./sentence.js";
import { PCM_SAMPLE_RATE, synthesize } from "./tts.js";
import { languageLabel, type PluginConfig } from "./config.js";
import type { SseHub } from "./events.js";
import type { SpeechModes } from "./system-prompt.js";

interface SpeechDeps {
	hub: SseHub;
	modes: SpeechModes;
	getConfig: () => PluginConfig;
	resolveKeys: (config: PluginConfig) => string[];
	/** Per-session effective config (global ⊕ workspace override). */
	resolveSession: (sessionId: string) => PluginConfig;
}

interface ActiveSpeech {
	utteranceId: string;
	abort: AbortController;
}

/** The provider/model a session last conversed with (translation reuses it). */
interface SessionModel {
	provider: string;
	model: string;
}

/**
 * Serial translation queue with a small backlog cap: subtitles are timely —
 * when more than two sentences are still waiting, the oldest queued
 * translation is dropped (its line is stale by the time it would render).
 */
class TranslationQueue {
	private tasks: Array<() => Promise<void>> = [];
	private running = false;

	push(task: () => Promise<void>): void {
		this.tasks.push(task);
		if (this.tasks.length > 2) this.tasks.shift();
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.tasks.length > 0) {
				const task = this.tasks.shift();
				if (!task) continue;
				try {
					await task();
				} catch {
					/* one bad task must never stall the queue (or the host) */
				}
			}
		} finally {
			this.running = false;
		}
	}
}

export function applySpeechTap(ctx: Context, deps: SpeechDeps): void {
	const active = new Map<string, ActiveSpeech>();
	const translations = new Map<string, TranslationQueue>();

	const translate = async (
		sessionId: string,
		model: SessionModel,
		lineId: string,
		text: string,
		targetLanguage: string,
		signal: AbortSignal,
	): Promise<void> => {
		if (signal.aborted || !deps.hub.has(sessionId)) return;
		let translated = "";
		try {
			const stream = ctx.llm.stream({
				provider: model.provider,
				model: model.model,
				messages: [createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })],
				system: `You translate speech subtitles. Translate the user's text into ${languageLabel(targetLanguage)}. Reply with ONLY the translation — no notes, no quotes, no original text. If the text is already in the target language, reply with it unchanged. Keep it natural and concise.`,
				signal,
			});
			for await (const chunk of stream) {
				if (signal.aborted) return;
				if (chunk.type === "text-delta" && chunk.text) translated += chunk.text;
			}
		} catch {
			return; // translation is best-effort; the original line stands
		}
		translated = translated.trim();
		if (translated && translated !== text) {
			deps.hub.emit(sessionId, "subtitle-translation", { lineId, text: translated });
		}
	};

	ctx.on("llm/stream", (options, next) => {
		const sessionId = options.sessionId === undefined ? "" : String(options.sessionId);
		// Auxiliary calls (titles, compaction) pass through untouched.
		if (!sessionId || options.purpose !== undefined) return next();
		if (!deps.hub.has(sessionId)) {
			// Unwatched, but a recently-exited session's turn end clears the
			// exit reminder in the system prompt — observe completion only
			// for those sessions, leave everything else fully untouched.
			if (!deps.modes.isExited(sessionId)) return next();
			const stream = next();
			return (async function* () {
				try {
					for await (const chunk of stream) yield chunk;
				} finally {
					deps.modes.clearExited(sessionId);
				}
			})();
		}
		// The conversation's own model — translation calls reuse it.
		return speak(deps, active, translations, translate, sessionId, { provider: options.provider, model: options.model }, next());
	});

	// REC-05: the last SSE listener for a session left — stop synthesizing
	// audio nobody will hear (saves Fish Audio quota) and drop its queue.
	deps.hub.onLastClose((sessionId) => {
		active.get(sessionId)?.abort.abort();
		translations.delete(sessionId);
	});
}

type TranslateFn = (
	sessionId: string,
	model: SessionModel,
	lineId: string,
	text: string,
	targetLanguage: string,
	signal: AbortSignal,
) => Promise<void>;

/**
 * Wrap one model stream. Emits speech-start/audio-start up front, feeds each
 * complete sentence into the serial TTS queue, and returns as soon as the
 * model stream ends — audio-end/speech-end are emitted by the background
 * queue drain. A superseding stream (or stream error / last listener leaving)
 * aborts pending TTS and emits speech-end(reason:"aborted").
 */
async function* speak(
	deps: SpeechDeps,
	active: Map<string, ActiveSpeech>,
	translations: Map<string, TranslationQueue>,
	translate: TranslateFn,
	sessionId: string,
	model: SessionModel,
	chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
	const config = deps.resolveSession(sessionId);
	const apiKeys = deps.resolveKeys(deps.getConfig());
	// A new utterance supersedes the previous one for this session.
	active.get(sessionId)?.abort.abort();
	const controller = new AbortController();
	const utteranceId = randomUUID().slice(0, 8);
	active.set(sessionId, { utteranceId, abort: controller });

	const buffer = new SentenceBuffer();
	let seq = 0;
	let lineSeq = 0;
	// Serial sentence pipeline: each entry waits for the previous TTS call.
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (sentence: string): void => {
		const lineId = `${utteranceId}-${++lineSeq}`;
		queue = queue.then(() =>
			speakSentence(deps, translations, translate, sessionId, model, utteranceId, lineId, sentence, config, apiKeys, controller.signal, () => seq++)
		);
	};

	let settled = false;
	const settle = (reason: "finish" | "aborted"): void => {
		if (settled) return;
		settled = true;
		if (reason === "finish") deps.hub.emit(sessionId, "audio-end", { utteranceId });
		deps.hub.emit(sessionId, "speech-end", { utteranceId, reason });
		if (active.get(sessionId)?.utteranceId === utteranceId) active.delete(sessionId);
	};

	deps.hub.emit(sessionId, "speech-start", { utteranceId });
	deps.hub.emit(sessionId, "audio-start", { utteranceId, sampleRate: PCM_SAMPLE_RATE });
	if (apiKeys.length === 0) {
		deps.hub.emit(sessionId, "error", { message: "未配置 Fish Audio API key（live2d-voice.json → apiKeys 或 apiKeyFile），语音朗读不可用" });
	}

	// The drain must never reject (TTS failures are reported as error events).
	const drain = () =>
		Promise.resolve(queue)
			.then(() => settle(controller.signal.aborted ? "aborted" : "finish"))
			.catch(() => settle("aborted"));

	try {
		for await (const chunk of chunks) {
			if (chunk.type === "text-delta" && chunk.text) {
				for (const sentence of buffer.push(chunk.text)) enqueue(sentence);
			}
			yield chunk;
		}
		for (const sentence of buffer.flush()) enqueue(sentence);
		// BLK-02: do NOT await the queue here — the turn settles now; the
		// background drain owns audio-end/speech-end.
		void drain();
	} catch (error) {
		controller.abort();
		queue.catch(() => undefined);
		void drain();
		throw error;
	}
}

/**
 * Speak one sentence: expression → TTS (streaming PCM). The subtitle is
 * emitted with the first PCM chunk so it tracks actual playback rather than
 * racing ahead of synthesis; when no TTS runs (no keys / failure) it falls
 * back to an immediate emit. Translation into the subtitle language is
 * enqueued after the subtitle (best-effort, serial per session). Never
 * rejects.
 */
async function speakSentence(
	deps: SpeechDeps,
	translations: Map<string, TranslationQueue>,
	translate: TranslateFn,
	sessionId: string,
	model: SessionModel,
	utteranceId: string,
	lineId: string,
	raw: string,
	config: PluginConfig,
	apiKeys: string[],
	signal: AbortSignal,
	nextSeq: () => number,
): Promise<void> {
	const vocabulary = new Set(Object.keys(config.emotionMap));
	const { clean, emotions } = extractEmotionTags(raw, vocabulary);
	const emotion = emotions.at(-1);
	if (emotion !== undefined) {
		deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression: config.emotionMap[emotion] });
	}
	const text = clean.trim();
	if (!text) return;
	let subtitled = false;
	const emitSubtitle = (): void => {
		if (subtitled) return;
		subtitled = true;
		deps.hub.emit(sessionId, "subtitle", { role: "assistant", text, utteranceId, lineId });
	};
	if (apiKeys.length === 0) {
		emitSubtitle();
		return;
	}
	try {
		await synthesize({ text, voiceId: config.voiceId, model: config.ttsModel, apiKeys, signal }, (pcm) => {
			emitSubtitle();
			deps.hub.emit(sessionId, "audio", { utteranceId, seq: nextSeq(), b64: pcm.toString("base64") });
		});
	} catch (error) {
		if (signal.aborted) return;
		deps.hub.emit(sessionId, "error", { message: error instanceof Error ? error.message : String(error) });
	} finally {
		// No audio will come (TTS failed or produced nothing) — still subtitle.
		emitSubtitle();
	}
	// Subtitle translation: only when a distinct target language is set.
	const target = config.subtitleLanguage;
	if (target && target !== "off" && target !== config.speechLanguage && deps.hub.has(sessionId)) {
		let queue = translations.get(sessionId);
		if (queue === undefined) {
			queue = new TranslationQueue();
			translations.set(sessionId, queue);
		}
		queue.push(() => translate(sessionId, model, lineId, text, target, signal));
	}
}
