/**
 * System-prompt section for the Live2D speech format — injected per session,
 * only while that session's Live2D view is actually open.
 *
 * Gating (mirrors dsh-plan-mode's per-session section pattern):
 *   - No model configured → never inject anything.
 *   - Session has a live SSE listener (Live2D tab active) → inject the
 *     speech-format section (plus the user's custom speechPrompt) and mark
 *     the session "live".
 *   - Session was live but the view is gone (user switched to the Chat tab
 *     or another session) → first assemblies still get a short exit reminder
 *     telling the model the tag/format constraints no longer apply, so a
 *     conversation can seamlessly continue in normal chat mode.
 *
 * The "exited" reminder clears once an unwatched conversation stream for the
 * session completes (see speech.ts's tap), so it does not linger forever.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SseHub } from "./events.js";
import { speechLanguageInstruction, type PluginConfig } from "./config.js";

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

export function applySystemPrompt(ctx: Context, deps: SystemPromptDeps): (() => void) | undefined {
	const systemPrompt = ctx.get("systemPrompt", false) as
		| { section(section: { name: string; order: number; text: string | ((context: unknown) => string) }): () => void }
		| undefined;
	if (systemPrompt === undefined || systemPrompt === null) {
		ctx.logger.info("dsh-live2d-voice: no systemPrompt service composed; speech-format section not installed.");
		return undefined;
	}
	return systemPrompt.section({
		name: "dsh-live2d-voice:speech-format",
		order: 9800,
		text: (context: unknown) => {
			const agent = (context as { agent?: AssembleAgentLike }).agent;
			const sessionId = sessionKeyOf(agent);
			if (!sessionId) return "";
			const config = deps.resolveSession(sessionId);
			// Without a model there is no Live2D mode at all — never pollute.
			if (!config.modelPath) return "";
			const mode = deps.modes.transition(sessionId, deps.hub.has(sessionId));
			if (mode === "live") return liveSection(config);
			if (mode === "exited") return EXIT_SECTION;
			return "";
		},
	});
}
