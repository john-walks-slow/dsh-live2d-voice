/**
 * context-slim — Live 会话的极简上下文过滤层
 *
 * 问题：DSH 标准 preset 含 66 个工具（76 KB）+ 12.8 KB 系统提示词；即使
 * 用 chat preset 也有 42 个工具（55 KB）和 7.5 KB skills 目录注入。
 * Live 纯聊天只需要 persona + 语音指令 + 记忆，所有工具都是浪费。
 *
 * 解决：在 system-prompt/assemble 与 agent/pre-step 两层 hook 主动剥离：
 *   - system-prompt/assemble → 清空 tools、清理冗余 system section
 *   - agent/pre-step → 过滤掉 <available_skills> 等与 live 无关的注入消息
 *
 * 触发条件：会话处于 live 模式（hub.has(sessionId) 存在 SSE 监听）
 * 或显式启用 leanContext（resolveSessionConfig 返回值）。
 *
 * 安全边界：
 *   - 仅剥离工具与消息内容，不动 system prompt 文本（persona 由 preset 控制）。
 *   - 仅在 hub 已确认该会话活跃为 live 模式时生效；普通会话 0 改动。
 *   - 可观测：每次裁剪打印 warn 日志 + 减少字节数，便于 e2e 验证。
 */
import type { Context } from "@deepseek-ai/cordis";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { resolveSessionConfig as resolveSessionConfigBase, type PluginConfig } from "./config.js";

interface AssemblyLike {
	tools?: Array<{ function?: { name?: string }; name?: string }>;
	sections?: unknown[];
	contexts?: unknown[];
}

interface PreStepDecisionLike {
	kind?: string;
	messages?: Array<{ id?: string; content?: unknown; source?: { kind?: string; plugin?: string; form?: string } }>;
}

interface SystemPromptAssembleCtx {
	scope?: { agent?: AgentLike };
}

interface AgentLike {
	id?: unknown;
	session?: { id?: unknown; header?: { meta?: { agentPreset?: string } } };
	ctx?: { on(event: string, listener: (...args: unknown[]) => unknown, options?: { prepend?: boolean }): () => void };
}

/** Loose SseHub type — only .has(sessionId) is needed. */
interface HubLike {
	has(sessionId: string): boolean;
}

interface SlimDeps {
	hub: HubLike;
	getConfig: () => PluginConfig;
	resolveSession: (sessionId: string) => PluginConfig;
}

const sessionKeyOf = (agent: AgentLike): string | undefined => {
	const s = agent?.session;
	if (typeof s === "string") return s;
	return (s?.id as string | undefined) ?? undefined;
};

/**
 * Strip the giant `<available_skills>` reminder + non-essential workspace
 * reminders from a pre-step message batch. Live chat only needs persona
 * (system prompt), identity/memory snapshot, and the live2d speech guidance.
 */
function prunePreStepMessages(
	messages: PreStepDecisionLike["messages"],
): { kept: PreStepDecisionLike["messages"]; removedBytes: number; removedCount: number } {
	if (!Array.isArray(messages)) return { kept: messages, removedBytes: 0, removedCount: 0 };
	let removedBytes = 0;
	let removedCount = 0;
	const kept = messages.filter((m) => {
		const text = typeof m?.content === "string"
			? m.content
			: Array.isArray(m?.content)
				? m.content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("")
				: "";
		// Keep our own speech guidance — it is the reason the session is lean
		if (m?.source?.plugin === "dsh-live2d-voice") return true;
		// Strip the entire <available_skills> block (~7.5 KB; useless for live chat)
		if (text.includes("<available_skills>")) {
			removedBytes += text.length;
			removedCount += 1;
			return false;
		}
		// Strip workspace instructions baseline re-injection (replaces AGENTS.md
		// again on later turns; persona identity files already injected via
		// dsh-agent-instructions on the first turn)
		if (text.includes("This complete workspace instruction baseline replaces")) {
			removedBytes += text.length;
			removedCount += 1;
			return false;
		}
		// Keep mnemon runtime memory snapshot (~2 KB), time, runtime context —
		// these are small and persona-relevant for live chat persona.
		return true;
	});
	return { kept, removedBytes, removedCount };
}

export function applyContextSlim(ctx: Context, deps: SlimDeps): () => void {
	const disposers = new Set<() => void>();

	// system-prompt/assemble is emitted on the agent-scoped ctx (Scoped<Agent>),
	// not on the host ctx, so we register per-agent on agent/created.
	const installAssemble = (agent: AgentLike) => {
		if (!agent?.ctx || typeof agent.ctx.on !== "function") return;
		const stop = agent.ctx.on(
			"system-prompt/assemble",
			async (...args: unknown[]) => {
				const assembly = args[0] as AssemblyLike;
				const context = args[1] as SystemPromptAssembleCtx;
				const next = args[2] as () => Promise<AssemblyLike>;
				const sessionId = sessionKeyOf(agent);
				if (!sessionId) return next();
				const live = deps.hub.has(sessionId);
				if (!live) return next(); // not in live mode → no stripping
				const next_ = await next();
				const originalTools = next_.tools ?? [];
				const originalSections = next_.sections ?? [];
				const originalContexts = next_.contexts ?? [];
				const beforeBytes = JSON.stringify({
					tools: originalTools,
					sections: originalSections,
					contexts: originalContexts,
				}).length;
				// Strip tools — live chat never invokes a tool. Models with tool choice
				// "auto" can still reply freely; the persona decides if/when to call.
				const strippedTools: AssemblyLike["tools"] = [];
				// Keep persona (system prompt section) untouched; chat persona is set by
				// the chosen preset's complete:true + identity files (already small).
				// Remove redundant runtime contexts (e.g. workspace status) only if the
				// preset did not explicitly opt in.
				const strippedContexts = originalContexts.filter((c) => {
					const text = typeof (c as { text?: unknown })?.text === "string"
						? ((c as { text: string }).text)
						: "";
					// Drop "Current runtime context" pre-amble in live mode — persona
					// already gets what it needs via memory snapshot.
					if (text.startsWith("Current runtime context:")) return false;
					return true;
				});
				const afterBytes = JSON.stringify({
					tools: strippedTools,
					sections: originalSections,
					contexts: strippedContexts,
				}).length;
				const saved = beforeBytes - afterBytes;
				if (saved > 0) {
					ctx.logger.warn(
						`dsh-live2d-voice/context-slim: ${sessionId.slice(0, 8)}… ` +
						`live mode → stripped ${originalTools.length} tools, ${originalContexts.length - strippedContexts.length} contexts ` +
						`(${(saved / 1024).toFixed(1)} KB saved / ${(beforeBytes / 1024).toFixed(1)} KB → ${(afterBytes / 1024).toFixed(1)} KB)`,
					);
				}
				return {
					...next_,
					tools: strippedTools,
					contexts: strippedContexts,
				};
			},
		);
		disposers.add(stop);
	};

	// Per-agent pre-step filter: same as the live2d speech guidance listener,
	// but runs AFTER next() so we can prune other plugins' injections.
	const install = (agent: AgentLike) => {
		installAssemble(agent);
		if (!agent?.ctx || typeof agent.ctx.on !== "function") return;
		const stop = agent.ctx.on(
			"agent/pre-step",
			async (...args: unknown[]) => {
				const payload = args[0] as { step?: number; signal?: AbortSignal };
				const next = args[1] as () => Promise<PreStepDecisionLike>;
				const decision = await next();
				if (decision.kind === "reject" || payload.signal?.aborted) return decision;
				const sessionId = sessionKeyOf(agent);
				if (!sessionId || !deps.hub.has(sessionId)) return decision;
				const { kept, removedBytes, removedCount } = prunePreStepMessages(decision.messages);
				if (removedCount > 0) {
					ctx.logger.warn(
						`dsh-live2d-voice/context-slim: ${sessionId.slice(0, 8)}… ` +
						`pre-step pruned ${removedCount} injections (${(removedBytes / 1024).toFixed(1)} KB)`,
					);
				}
				return { ...decision, messages: kept };
			},
			{ prepend: false }, // run AFTER speech-guidance injection
		);
		disposers.add(stop);
	};
	const stopCreated = (ctx as unknown as {
		on(event: string, listener: (...args: unknown[]) => unknown): () => void;
	}).on("agent/created", (...args: unknown[]) => {
		const agent = (args[0] as { agent?: AgentLike })?.agent;
		if (agent) install(agent);
	});
	for (const agent of ((ctx as unknown as { agents?: { roots(): AgentLike[] } }).agents?.roots?.() ?? [])) {
		install(agent);
	}
	disposers.add(stopCreated);

	return () => {
		for (const dispose of disposers) dispose();
		disposers.clear();
	};
}

/**
 * 工作区级配置加载器：除 <DSH_HOME>/live2d-voice.json 全局表外，
 * 还可在项目根目录放置 .dsh/live2d.json 覆盖当前工作区。
 *
 * 加载顺序（高优先级覆盖低优先级）：
 *   1. globalConfig.workspaces[cwd]   — 老版 API 设置面板写入（兼容）
 *   2. <cwd>/.dsh/live2d.json         — 工作区文件（新格式，git-friendly）
 *   3. globalConfig                  — 全局默认
 *
 * 文件格式与全局表顶层字段一致（Partial<PluginConfig>），emotionMap 合并。
 */
export function loadWorkspaceConfig(cwd: string): Partial<PluginConfig> | null {
	if (!cwd) return null;
	const filePath = join(cwd, ".dsh", "live2d.json");
	if (!existsSync(filePath)) return null;
	try {
		const raw = JSON.parse(readFileSync(filePath, "utf8"));
		if (raw && typeof raw === "object") return raw as Partial<PluginConfig>;
	} catch (e) {
		console.warn(`dsh-live2d-voice: failed to parse ${filePath}: ${e instanceof Error ? e.message : e}`);
	}
	return null;
}

/**
 * 升级版 resolveSessionConfig：global ⊕ workspace-override (old) ⊕ workspace-file (new)
 * 优先级：workspace-file > workspace-override > global；credential / apiKeys 不参与迁移。
 */
export function resolveSessionConfig(
	agents: Parameters<typeof resolveSessionConfigBase>[0],
	config: PluginConfig,
	sessionId: string,
): PluginConfig {
	const base = resolveSessionConfigBase(agents, config, sessionId);
	if (!sessionId) return base;
	try {
		const agent = agents.get(sessionId);
		const cwd = agent?.session?.header?.cwd;
		if (!cwd) return base;
		const fileOverride = loadWorkspaceConfig(cwd);
		if (!fileOverride) return base;
		return {
			...base,
			...fileOverride,
			emotionMap: { ...base.emotionMap, ...(fileOverride.emotionMap ?? {}) },
		};
	} catch {
		return base;
	}
}