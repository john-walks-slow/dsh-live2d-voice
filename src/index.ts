/**
 * dsh-live2d-voice — Live2D session view with realtime voice.
 *
 * Host half:
 *   - llm/stream tap (src/speech.ts): sentences the watched session's model
 *     stream into expressions, subtitles, and streamed Fish Audio PCM.
 *   - player pipeline (src/player.ts): third-person mode — the user's line
 *     is polished, spoken by the player's own avatar, then submitted.
 *   - speech-format guidance (src/system-prompt.ts): the [emotion] tag format,
 *     injected as a per-turn user plugin message (mnemon-style) only while the
 *     session's Live2D view is open — immune to preset `complete` semantics.
 *   - web routes (src/routes.ts): SSE hub, config, message submission, model
 *     assets, and the Cubism Core script injection.
 *
 * Configuration lives in <DSH_HOME>/live2d-voice.json (src/config.ts), not in
 * cordis config, so the GUI can rewrite it at runtime.
 */

import type { Context } from "@deepseek-ai/cordis";
import { loadConfig, resolveApiKeys, saveConfig } from "./config.js";
import { SseHub } from "./events.js";
import { applySpeechTap } from "./speech.js";
import { SpeechModes, applySpeechInjection } from "./system-prompt.js";
import { applyContextSlim, resolveSessionConfig } from "./context-slim.js";
import { installRoutes } from "./routes.js";
import { applyCameraTool, CameraBridge } from "./camera-tool.js";
import { PlayerPipeline } from "./player.js";

export const name = "dsh-live2d-voice";
export const inject = ["agents", "llm", "attachments", "sessionController"];

export function apply(ctx: Context): () => void {
	const hub = new SseHub();
	const modes = new SpeechModes();
	// Config is re-read on every access so GUI edits apply without a reload.
	const getConfig = loadConfig;

	const supersedeAssistant = applySpeechTap(ctx, {
		hub,
		modes,
		getConfig,
		resolveKeys: resolveApiKeys,
		resolveSession: (sessionId) => resolveSessionConfig(ctx.agents, getConfig(), sessionId),
	});
	const disposePrompt = applySpeechInjection(ctx, {
		hub,
		modes,
		getConfig,
		resolveSession: (sessionId) => resolveSessionConfig(ctx.agents, getConfig(), sessionId),
	});
	const disposeSlim = applyContextSlim(ctx, {
		hub,
		getConfig,
		resolveSession: (sessionId) => resolveSessionConfig(ctx.agents, getConfig(), sessionId),
	});
	const playerPipeline = new PlayerPipeline(ctx, {
		hub,
		getConfig,
		resolveKeys: resolveApiKeys,
		resolveSession: (sessionId) => resolveSessionConfig(ctx.agents, getConfig(), sessionId),
		supersedeAssistant,
	});
	const cameraBridge = new CameraBridge(hub);
	const disposeCameraTool = applyCameraTool(ctx, hub, cameraBridge);
	const disposeRoutes = installRoutes(ctx, { hub, getConfig, resolveKeys: resolveApiKeys, saveConfig, cameraBridge, playerPipeline });

	ctx.logger.info("dsh-live2d-voice: loaded (config: " + loadConfig().voiceId.slice(0, 8) + "… voice)");
	return () => {
		disposeRoutes?.();
		disposeCameraTool();
		playerPipeline.dispose();
		disposePrompt?.();
		disposeSlim();
	};
}
