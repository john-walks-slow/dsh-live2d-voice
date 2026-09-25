/**
 * Third-person mode: the player-avatar speech pipeline.
 *
 * Every user line submitted from the Live view while third-person mode is on
 * flows through here BEFORE it reaches the agent:
 *
 *   polish (optional) → player TTS (speaker:"player" SSE events) → submit
 *
 * Ordering guarantee: the message is submitted to the agent only after the
 * player line's TTS synthesis has fully settled, so on the wire the player's
 * audio chunks always precede the assistant's — the client's single FIFO
 * audio queue then renders "player speaks first, AI answers" for free, while
 * the agent's own generation (TTFT) overlaps the player line's *playback*.
 *
 * Tasks run serially per session (rapid inputs never interleave audio), and
 * starting a task supersedes the session's in-flight assistant TTS (the user
 * said something new — the AI's old line stops immediately). An aborted task
 * (last Live view closed) still submits its text: the conversation continues
 * in chat mode and user input is never lost.
 *
 * The polish call carries no sessionId, so the plugin's own llm/stream tap
 * never picks it up (same convention as subtitle translation).
 */

import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { extractEmotionTags, extractMotionTags } from "./sentence.js";
import { PCM_SAMPLE_RATE, synthesize } from "./tts.js";
import { languageLabel, type PluginConfig } from "./config.js";
import type { SseHub } from "./events.js";

/** Polish is a tiny one-shot call — anything past this is a hung stream. */
const POLISH_TIMEOUT_MS = 10_000;

export interface PlayerDeps {
	hub: SseHub;
	getConfig: () => PluginConfig;
	resolveKeys: (config: PluginConfig) => string[];
	/** Per-session effective config (global ⊕ workspace override). */
	resolveSession: (sessionId: string) => PluginConfig;
	/** Abort the session's in-flight assistant TTS (user interrupts the AI). */
	supersedeAssistant: (sessionId: string) => void;
}

/** Loose agent shape — steer/followup mirror the /message route's usage. */
interface AgentLike {
	steer: (message: unknown) => void;
	followup: (message: unknown) => void;
	session?: { requestHeader?: () => { config?: { provider: string; model: string } } | undefined };
}

export class PlayerPipeline {
	private readonly queues = new Map<string, Promise<void>>();
	private readonly controllers = new Map<string, AbortController>();
	private readonly stopListening: () => void;

	constructor(
		private readonly ctx: Context,
		private readonly deps: PlayerDeps,
	) {
		this.stopListening = deps.hub.onLastClose((sessionId) => {
			// Nobody is watching anymore — stop spending TTS quota. The
			// in-flight task still submits its text (input is never lost).
			this.controllers.get(sessionId)?.abort();
			this.controllers.delete(sessionId);
		});
	}

	dispose(): void {
		this.stopListening();
		for (const controller of this.controllers.values()) controller.abort();
		this.controllers.clear();
		this.queues.clear();
	}

	/**
	 * Enqueue one player line. Returns immediately; the polished line, its
	 * audio, and the assistant reply all arrive over the session SSE.
	 */
	submit(sessionId: string, rawText: string, mode: "queue" | "steer"): void {
		const text = rawText.trim();
		if (!text) return;
		const tail = this.queues.get(sessionId) ?? Promise.resolve();
		const run = tail
			.catch(() => undefined)
			.then(() => this.process(sessionId, text, mode))
			.catch((error: unknown) => {
				this.deps.hub.emit(sessionId, "error", {
					message: `玩家台词处理失败：${error instanceof Error ? error.message : String(error)}`,
				});
			});
		this.queues.set(sessionId, run);
		void run.then(() => {
			if (this.queues.get(sessionId) === run) this.queues.delete(sessionId);
		});
	}

	private async process(sessionId: string, text: string, mode: "queue" | "steer"): Promise<void> {
		const config = this.deps.resolveSession(sessionId);
		// Third-person flipped off before this task ran → plain first-person
		// submit (the input must still reach the agent).
		if (!config.thirdPerson) {
			await this.submitToAgent(sessionId, text, mode);
			return;
		}
		// The user's new line interrupts whatever the AI is still synthesizing.
		this.deps.supersedeAssistant(sessionId);
		const controller = new AbortController();
		this.controllers.set(sessionId, controller);
		const utteranceId = randomUUID().slice(0, 8);
		try {
			// 1) Polish into the player persona's line (only while watched —
			//    with no Live view there is no avatar to speak it).
			let finalText = text;
			if (config.playerPolish && this.deps.hub.has(sessionId)) {
				const polished = await this.polish(sessionId, text, config, controller.signal);
				if (polished) finalText = polished;
			}
			// 2) Emotion tag → player expression. The event is emitted inside
			//    speak() AFTER speech-start: the client gates expression (and
			//    audio) on the utterance being active, which only happens once
			//    its speech-start has arrived.
			const vocabulary = new Set(Object.keys(config.playerEmotionMap));
			const { clean, emotions } = extractEmotionTags(finalText, vocabulary);
			const emotion = emotions.at(-1);
			const expression = emotion === undefined ? undefined : config.playerEmotionMap[emotion];
			// Polish produced nothing but tags → speak the raw input instead.
			const spoken = clean.trim() || text;
			// 3) Player TTS — synthesis must fully settle before the submit so
			//    the assistant's audio never interleaves on the wire.
			if (this.deps.hub.has(sessionId)) {
				await this.speak(sessionId, utteranceId, spoken, config, controller.signal, emotion, expression);
			}
			// 4) What the avatar said is what the AI hears (and what the
			//    session log records as the user message).
			await this.submitToAgent(sessionId, spoken, mode);
		} finally {
			if (this.controllers.get(sessionId) === controller) this.controllers.delete(sessionId);
		}
	}

	/** One-shot polish call; "" means "fall back to the raw text". */
	private async polish(sessionId: string, text: string, config: PluginConfig, signal: AbortSignal): Promise<string> {
		const model = await this.resolveSessionModel(sessionId);
		if (model === undefined || signal.aborted) return "";
		const vocabulary = Object.keys(config.playerEmotionMap);
		const lines = [
			"你是角色扮演台本师。用户发来他想对另一个角色说的话（可能是口语、随手打字或另一种语言），请改写成由用户的角色化身亲口说出的台词。",
			"- 保留原文的全部信息点与意图，长度随内容而定；只有简短寒暄才收敛为两句以内。",
			"- 台词口语化、自然、适合直接朗读；不要 Markdown、列表、括号动作说明或旁白。",
			`- 在台词开头用一个方括号情绪标签标注情绪，只能从这些标签里选：${vocabulary.map((e) => `[${e}]`).join(" ")}；没有明显情绪可省略。`,
		];
		const language = config.playerSpeechLanguage;
		lines.push(language && language !== "auto" ? `- 台词始终用${languageLabel(language)}说出。` : "- 台词语言跟随原文语言。");
		const persona = config.playerPrompt.trim();
		if (persona) lines.push(`- 用户角色的人设：${persona}`);
		lines.push("只输出改写后的台词本身，不要解释、引号或原文。");
		// A hung polish call must never swallow the line (the promise is
		// "polish failure/timeout → speak the raw text"): cap the call, and
		// let the cap or the parent abort resolve it to "".
		const capped = new AbortController();
		const capTimer = setTimeout(() => capped.abort(), POLISH_TIMEOUT_MS);
		const forwardAbort = () => capped.abort();
		signal.addEventListener("abort", forwardAbort, { once: true });
		let out = "";
		try {
			const stream = this.ctx.llm.stream({
				provider: model.provider,
				model: model.model,
				messages: [createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })],
				system: lines.join("\n"),
				signal: capped.signal,
			});
			for await (const chunk of stream) {
				if (capped.signal.aborted) return "";
				if (chunk.type === "text-delta" && chunk.text) out += chunk.text;
			}
		} catch {
			return ""; // polish is best-effort; the raw line stands
		} finally {
			clearTimeout(capTimer);
			signal.removeEventListener("abort", forwardAbort);
		}
		return out.trim();
	}

	/** Stream the player line as Fish TTS PCM over SSE (speaker:"player"). */
	private async speak(
		sessionId: string,
		utteranceId: string,
		text: string,
		config: PluginConfig,
		signal: AbortSignal,
		emotion?: string,
		expression?: number | string,
	): Promise<void> {
		const apiKeys = this.deps.resolveKeys(this.deps.getConfig());
		const voiceId = config.playerVoiceId || config.voiceId;
		this.deps.hub.emit(sessionId, "speech-start", { utteranceId, speaker: "player" });
		this.deps.hub.emit(sessionId, "audio-start", { utteranceId, sampleRate: PCM_SAMPLE_RATE, speaker: "player" });
		if (emotion !== undefined && expression !== undefined) {
			this.deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression, speaker: "player" });
		}
		const { motions } = extractMotionTags(text);
		for (const motion of motions) {
			this.deps.hub.emit(sessionId, "motion", { utteranceId, motion, speaker: "player" });
		}
		if (apiKeys.length === 0) {
			this.emitSubtitle(sessionId, utteranceId, text);
			this.settleSpeech(sessionId, utteranceId, "finish");
			return;
		}
		let subtitled = false;
		let seq = 0;
		const emitSubtitleOnce = (audioSeq?: number): void => {
			if (subtitled) return;
			subtitled = true;
			this.emitSubtitle(sessionId, utteranceId, text, audioSeq);
		};
		try {
			await synthesize({ text, voiceId, model: config.ttsModel, apiKeys, signal }, (pcm) => {
				if (signal.aborted) return;
				// The subtitle rides the first PCM chunk's seq so the client
				// holds it until that chunk actually starts playing — the
				// same voice–subtitle sync as assistant lines.
				emitSubtitleOnce(seq);
				this.deps.hub.emit(sessionId, "audio", {
					utteranceId,
					seq: seq++,
					b64: pcm.toString("base64"),
					speaker: "player",
				});
			});
		} catch (error) {
			if (!signal.aborted) {
				this.deps.hub.emit(sessionId, "error", {
					message: error instanceof Error ? error.message : String(error),
				});
			}
		} finally {
			// No audio will come (TTS failed / aborted) — still subtitle.
			emitSubtitleOnce();
			this.settleSpeech(sessionId, utteranceId, signal.aborted ? "aborted" : "finish");
		}
	}

	private emitSubtitle(sessionId: string, utteranceId: string, text: string, audioSeq?: number): void {
		this.deps.hub.emit(sessionId, "subtitle", {
			role: "user",
			text,
			utteranceId,
			lineId: `${utteranceId}-1`,
			...(audioSeq !== undefined ? { audioSeq } : {}),
			speaker: "player",
		});
	}

	private settleSpeech(sessionId: string, utteranceId: string, reason: "finish" | "aborted"): void {
		this.deps.hub.emit(sessionId, "audio-end", { utteranceId, speaker: "player" });
		this.deps.hub.emit(sessionId, "speech-end", { utteranceId, reason, speaker: "player" });
	}

	/** The session's current conversation model (polish reuses it). */
	private async resolveSessionModel(sessionId: string): Promise<{ provider: string; model: string } | undefined> {
		try {
			const agent = (await this.resolveAgent(sessionId)) as AgentLike | undefined;
			const header = agent?.session?.requestHeader?.();
			if (header?.config) return { provider: header.config.provider, model: header.config.model };
			const catalog = await (
				this.ctx as unknown as {
					sessionController: { modelCatalog(): Promise<{ default?: { provider: string; model: string } }> };
				}
			).sessionController.modelCatalog();
			if (catalog?.default) return { provider: catalog.default.provider, model: catalog.default.model };
		} catch {
			/* fall through — no polish without a resolvable model */
		}
		return undefined;
	}

	/** Resolve the live agent, cold-resuming the session like /message does. */
	private async resolveAgent(sessionId: string): Promise<unknown> {
		const existing = (this.ctx as unknown as { agents: { get(id: unknown): unknown } }).agents.get(sessionId);
		if (existing !== undefined) return existing;
		const found = await (
			this.ctx as unknown as {
				sessionController: { resolveAgent(id: SessionId): Promise<{ agent?: unknown; error?: { message?: string } }> };
			}
		).sessionController.resolveAgent(sessionId as SessionId);
		if (found !== undefined && "agent" in found && found.agent !== undefined) return found.agent;
		const detail = found !== undefined && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
		throw new Error(detail);
	}

	private async submitToAgent(sessionId: string, text: string, mode: "queue" | "steer"): Promise<void> {
		try {
			const agent = (await this.resolveAgent(sessionId)) as AgentLike | undefined;
			if (agent === undefined) throw new Error("session not found");
			const content: ContentBlock[] = [{ type: "text", text }];
			const message = createUserMessage({ content, source: { kind: "user" } });
			if (mode === "steer") agent.steer(message);
			else agent.followup(message);
		} catch (error) {
			this.deps.hub.emit(sessionId, "error", {
				message: `消息提交失败：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
}
