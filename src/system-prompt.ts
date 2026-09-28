/**
 * Live2D speech-format guidance — injected as a user message per turn
 * (mnemon-style plugin message, see dsh-mnemon), only while that session's
 * Live2D view is actually open.
 *
 * Why a user message instead of a system-prompt section: presets that set
 * `complete: true` (e.g. the chat preset) replace the whole system-prompt
 * section list with the persona section, silently dropping any plugin
 * section — the [emotion] tag / speech constraints never reached the model.
 * Injecting at `agent/pre-step` (appending a role:"user" plugin message to
 * the assembled messages) bypasses system-prompt assembly entirely and works
 * under every preset.
 *
 * Gating:
 *   - No model configured → never inject anything.
 *   - Session has a live SSE listener (Live2D tab active) → inject the
 *     speech-format guidance (plus the user's custom speechPrompt) and mark
 *     the session "live".
 *   - Session was live but the view is gone (user switched to the Chat tab
 *     or another session) → first turns still get a short exit reminder
 *     telling the model the tag/format constraints no longer apply, so a
 *     conversation can seamlessly continue in normal chat mode.
 *
 * The "exited" reminder clears once an unwatched conversation stream for the
 * session completes (see speech.ts's tap), so it does not linger forever.
 */

import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { SseHub } from "./events.js";
import { speechLanguageInstruction, resolveModelCatalog, resolveModelSelection, extractModelMotions, type PluginConfig } from "./config.js";

export type SessionSpeechMode = "live" | "exited";

/** Per-session live2d mode state shared with the llm/stream tap. */
export class SpeechModes {
	private modes = new Map<string, SessionSpeechMode>();

	/** Resolve the mode for an assembly; updates state transitions. */
	transition(sessionId: string, isLive: boolean): SessionSpeechMode | undefined {
		this.evictIfNeeded();
		if (isLive) {
			this.modes.set(sessionId, "live");
			return "live";
		}
		if (this.modes.get(sessionId) === "live") {
			this.modes.set(sessionId, "exited");
			return "exited";
		}
		return this.modes.get(sessionId);
	}

	isExited(sessionId: string): boolean {
		return this.modes.get(sessionId) === "exited";
	}

	/** Drop the exit reminder (called after an unwatched turn completes). */
	clearExited(sessionId: string): void {
		if (this.modes.get(sessionId) === "exited") this.modes.delete(sessionId);
	}

	/**
	 * Bound the map: sessions deleted mid-live never return to clear their
	 * entry, so past a soft cap drop every "exited" entry (they are
	 * re-derivable) — live entries must survive as mode truth.
	 */
	private evictIfNeeded(): void {
		if (this.modes.size <= 256) return;
		for (const [sessionId, mode] of this.modes) {
			if (mode === "exited") this.modes.delete(sessionId);
		}
	}
}

/** Runtime shape of the agent the dsh-agent merge adds to AssembleContext. */
interface AssembleAgentLike {
	id?: unknown;
	session?: { id?: unknown } | string;
}

function sessionKeyOf(agent: AssembleAgentLike | undefined): string {
	if (!agent) return "";
	const session = agent.session;
	if (typeof session === "string") return session;
	if (session && typeof session === "object" && session.id !== undefined) return String(session.id);
	if (agent.id !== undefined) return String(agent.id);
	return "";
}

function liveSection(config: PluginConfig): string {
	const emotions = Object.keys(config.emotionMap);
	if (emotions.length === 0) return "";
	const lines = [
		"## Live2D 语音模式（当前会话）",
		"你的回复正被实时转成语音朗读并驱动一个 Live2D 角色说话，请遵守：",
		"- 用口语化、自然适合朗读的句子；不要输出列表、代码块、链接或 Markdown 符号；代码与命令改用简短口头描述。",
		"- 在每句或每个语义段的开头用方括号情绪标签标注情绪，只能从这些标签里选：",
		`  ${emotions.map((emotion) => `[${emotion}]`).join(" ")}`,
		"- 标签只用于控制角色表情，不会被朗读；没有情绪变化时省略标签即可。",
	];

	// Dynamically inject motion tags available for the current model.
	try {
		const catalog = resolveModelCatalog(config);
		const selection = resolveModelSelection(config, catalog);
		if (selection && config.modelPath) {
			const motions = extractModelMotions(join(config.modelPath, selection.relative));
			if (motions.length > 0) {
				const uniqueNames = Array.from(new Set(motions.map((m) => m.name)));
				lines.push(
					"- 你还可以控制角色的身体动作，在需要表达动作的句子中插入动作标签（标签只用于触发角色动画，不会被朗读，适度使用）：",
					`  ${uniqueNames.map((name) => `[motion:${name}]`).join(" ")}`
				);
			}
		}
	} catch {
		// graceful fallback if motion inspection fails
	}

	if (config.liveMode === "third") {
		lines.push("- 当前为第三人称模式：用户的消息由其角色化身说出（可能已经过润色或翻译），请把它当作角色扮演中对方的台词来回应。");
	} else if (config.liveMode === "call") {
		lines.push("- 当前为视频通话模式：用户正在和你的角色视频通话，用户的消息就是 TA 本人直接说出的话；回复会被朗读并驱动你的角色形象，就像通话画面对面的对话一样。");
	}
	const language = speechLanguageInstruction(config.speechLanguage, config.subtitleLanguage);
	if (language) lines.push(`- ${language}`);
	const custom = config.speechPrompt.trim();
	if (custom) lines.push("", "用户附加要求：", custom);
	return lines.join("\n");
}

const EXIT_SECTION = [
	"## 已退出 Live2D 语音模式",
	"用户已切回普通文字对话：正常使用 Markdown、列表与代码块；不要再输出方括号 [情绪] 标签，也不要再遵守语音朗读的格式限制。",
].join("\n");

export interface SystemPromptDeps {
	hub: SseHub;
	modes: SpeechModes;
	getConfig: () => PluginConfig;
	/** Per-session effective config (global ⊕ workspace override). */
	resolveSession: (sessionId: string) => PluginConfig;
}

/**
 * A role:"user" plugin message in the dsh-mnemon shape — the message bus
 * records it as a normal user/message event and the model sees it as a user
 * turn, so no preset's `complete` semantics can drop it.
 */
function createPluginMessage(text: string) {
	return {
		id: crypto.randomUUID(),
		role: "user",
		content: [{ type: "text", text }],
		source: {
			kind: "dsh-live2d-voice",
			form: "instructions",
			summary: "Live2D 语音模式指令",
		},
	};
}

/** Loose shape of a pre-step decision produced by `await next()`. */
interface PreStepDecisionLike {
	kind?: string;
	messages?: unknown[];
}

/** Loose shape of an agent (dsh-agent) carrying its scoped ctx + session. */
interface AgentLike {
	id?: unknown;
	ctx?: { on(event: string, listener: (...args: unknown[]) => unknown, options?: { prepend?: boolean }): () => void };
	session?: { id?: unknown } | string;
}

/**
 * Install the per-agent pre-step listener: on step 1 of every turn, append the
 * speech-format guidance as a user plugin message (once per messages batch).
 * Agents created later (new sessions / restarts) are picked up via
 * `agent/created`; already-existing roots are adopted eagerly.
 */
export function applySpeechInjection(ctx: Context, deps: SystemPromptDeps): () => void {
	const disposers = new Set<() => void>();

	const install = (agent: AgentLike) => {
		if (!agent?.ctx || typeof agent.ctx.on !== "function") return;
		const stop = agent.ctx.on(
			"agent/pre-step",
			async (...args: unknown[]) => {
				const payload = args[0] as { step?: number; signal?: AbortSignal };
				const next = args[1] as () => Promise<PreStepDecisionLike>;
				const decision = await next();
				if (decision.kind === "reject" || payload.signal?.aborted) return decision;
				if (payload.step !== 1) return decision;
				const messages = decision.messages;
				if (!Array.isArray(messages) || messages.length === 0) return decision;
				// The pre-step payload carries no agent — the listener is bound to
				// this agent's scoped ctx, so read the session from the closure.
				const sessionId = sessionKeyOf(agent);
				if (!sessionId) return decision;
				// Already injected for this batch (e.g. multi-agent fan-out) — never duplicate.
				if (messages.some((m) => (m as { source?: { kind?: string } })?.source?.kind === "dsh-live2d-voice")) {
					return decision;
				}
				const config = deps.resolveSession(sessionId);
				// Without a model there is no Live2D mode at all — never pollute.
				if (!config.modelPath) return decision;
				const mode = deps.modes.transition(sessionId, deps.hub.has(sessionId));
				const text = mode === "live" ? liveSection(config) : mode === "exited" ? EXIT_SECTION : "";
				if (!text) return decision;
				ctx.logger.warn(`dsh-live2d-voice: pre-step inject for ${sessionId.slice(0, 8)}… (mode=${mode})`);
				return { kind: "enter", messages: [...messages, createPluginMessage(text)] };
			},
			{ prepend: true },
		);
		disposers.add(() => stop());
		ctx.logger.warn(`dsh-live2d-voice: pre-step listener installed for agent ${String(agent.id ?? "").slice(0, 12) || "(root)"}`);
	};

	const onCreated = (ctx as unknown as {
		on(event: string, listener: (...args: unknown[]) => unknown): () => void;
	}).on;
	const stopCreated = onCreated("agent/created", (...args: unknown[]) => {
		const agent = (args[0] as { agent?: AgentLike })?.agent;
		if (agent) install(agent);
	});
	for (const agent of ((ctx as unknown as { agents?: { roots(): AgentLike[] } }).agents?.roots?.() ?? [])) install(agent);

	return () => {
		stopCreated();
		for (const dispose of disposers) dispose();
		disposers.clear();
	};
}
