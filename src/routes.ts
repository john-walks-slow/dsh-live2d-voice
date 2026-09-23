/**
 * Web routes on the host webserver (composed dsh web profiles only; a missing
 * webserver degrades to a no-op with one log line):
 *
 *   GET  /live2d-voice/stream?session=<id>   SSE event stream (the Live view)
 *   GET  /live2d-voice/config                sanitized config + voice presets
 *   POST /live2d-voice/config                update config fields
 *   POST /live2d-voice/message               submit a user message to a session
 *   GET  /live2d-voice/model                 which .model3.json to render
 *   GET  /live2d-voice/models/*              model assets (traversal-guarded)
 *   GET  /live2d-voice/core/live2dcubismcore.min.js  Cubism Core runtime
 *
 * Plus a `webserver/index-inject` row loading the Cubism Core script on every
 * index.html render (the model loader requires window.Live2DCubismCore).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { VOICE_PRESETS, type PluginConfig } from "./config.js";
import type { SseHub } from "./events.js";

const BODY_MAX_BYTES = 64 * 1024;
const MODELS_PREFIX = "/live2d-voice/models";
const CORE_SCRIPT_PATH = "/live2d-voice/core/live2dcubismcore.min.js";

interface WebServerLike {
	register(route: { kind: "exact" | "prefix"; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void;
}

export interface RouteDeps {
	hub: SseHub;
	getConfig: () => PluginConfig;
	saveConfig: (patch: Partial<PluginConfig>) => PluginConfig;
	resolveKeys: (config: PluginConfig) => string[];
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > BODY_MAX_BYTES) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body must be a JSON object");
	return parsed as Record<string, unknown>;
}

/** The sanitized config served to the GUI: API keys never leave the host. */
function publicConfig(config: PluginConfig, keyCount: number) {
	const { apiKeys: _apiKeys, ...rest } = config;
	return { ...rest, apiKeyCount: keyCount };
}

function mimeOf(path: string): string {
	if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (path.endsWith(".json")) return "application/json; charset=utf-8";
	if (path.endsWith(".png")) return "image/png";
	if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
	if (path.endsWith(".webp")) return "image/webp";
	if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
	return "application/octet-stream";
}

function serveFile(res: ServerResponse, path: string, maxAgeSeconds: number): boolean {
	let data: Buffer;
	try {
		data = readFileSync(path);
	} catch {
		return false;
	}
	res.writeHead(200, { "content-type": mimeOf(path), "cache-control": `public, max-age=${maxAgeSeconds}` });
	res.end(data);
	return true;
}

/** Locate the .model3.json inside the configured model directory. */
function findModelEntry(config: PluginConfig): { url: string; name: string } | undefined {
	if (!config.modelPath) return undefined;
	let files: string[];
	try {
		files = readdirSync(config.modelPath).filter((file) => file.endsWith(".model3.json")).sort();
	} catch {
		return undefined;
	}
	const entry = files[0];
	if (entry === undefined) return undefined;
	return { url: `${MODELS_PREFIX}/${encodeURIComponent(entry)}`, name: entry.replace(/\.model3\.json$/, "") };
}

export function installRoutes(ctx: Context, deps: RouteDeps): (() => void) | undefined {
	const webServer = (ctx as unknown as { get: (name: string, strict?: boolean) => unknown }).get("webServer", false) as WebServerLike | undefined;
	if (webServer === undefined || webServer === null) {
		ctx.logger.info("dsh-live2d-voice: no webserver composed; web routes not installed.");
		return undefined;
	}
	const disposers: Array<() => void> = [];

	// SSE stream.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/stream", handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim();
			if (!sessionId) {
				writeJson(res, 400, { code: "session_required", message: "query parameter `session` is required" });
				return;
			}
			deps.hub.attach(sessionId, req, res);
		} })
	);

	// Config read (sanitized) + write.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/config", handler: (req, res) => {
			if (req.method === "GET") {
				const config = deps.getConfig();
				writeJson(res, 200, { config: publicConfig(config, deps.resolveKeys(config).length), presets: VOICE_PRESETS });
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then((body) => {
					const patch: Partial<PluginConfig> = {};
					for (const key of ["modelPath", "voiceId", "ttsModel", "apiKeyFile", "sttLanguage", "speechPrompt"] as const) {
						if (typeof body[key] === "string") patch[key] = body[key] as string;
					}
					if (Array.isArray(body.apiKeys)) {
						patch.apiKeys = body.apiKeys.filter((key): key is string => typeof key === "string" && key.length > 0);
					}
					if (typeof body.emotionMap === "object" && body.emotionMap !== null && !Array.isArray(body.emotionMap)) {
						const emotionMap: Record<string, number | string> = {};
						for (const [emotion, expression] of Object.entries(body.emotionMap as Record<string, unknown>)) {
							if (typeof expression === "number" || typeof expression === "string") emotionMap[emotion] = expression;
						}
						patch.emotionMap = emotionMap;
					}
					const saved = deps.saveConfig(patch);
					writeJson(res, 200, { config: publicConfig(saved, deps.resolveKeys(saved).length) });
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_config", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	// Message submission (the Live view's text input).
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/message", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then((body) => {
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
					const text = typeof body.text === "string" ? body.text.trim() : "";
					if (!sessionId || !text) {
						writeJson(res, 400, { code: "bad_message", message: "sessionId and text are required" });
						return;
					}
					const agent = ctx.agents.get(sessionId as SessionId);
					if (agent === undefined) {
						writeJson(res, 404, { code: "session_not_found", message: `no live session ${sessionId}` });
						return;
					}
					const content: ContentBlock[] = [{ type: "text", text }];
					agent.followup(createUserMessage({ content, source: { kind: "user" } }));
					deps.hub.emit(sessionId, "subtitle", { role: "user", text });
					writeJson(res, 200, { accepted: true });
				})
				.catch((error: unknown) => {
					writeJson(res, 400, { code: "bad_message", message: error instanceof Error ? error.message : String(error) });
				});
		} })
	);

	// Model descriptor for the view.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/model", handler: (_req, res) => {
			const config = deps.getConfig();
			const entry = findModelEntry(config);
			if (entry === undefined) {
				writeJson(res, 200, { configured: Boolean(config.modelPath), url: undefined });
				return;
			}
			writeJson(res, 200, { configured: true, url: entry.url, name: entry.name });
		} })
	);

	// Model assets (traversal-guarded static file serving).
	disposers.push(
		webServer.register({ kind: "prefix", path: MODELS_PREFIX, handler: (req, res) => {
			const config = deps.getConfig();
			if (!config.modelPath) {
				writeJson(res, 404, { code: "model_not_configured" });
				return;
			}
			const url = (req.url ?? "").split("?")[0];
			let relative: string;
			try {
				relative = decodeURIComponent(url.slice(MODELS_PREFIX.length));
			} catch {
				writeJson(res, 400, { code: "bad_path" });
				return;
			}
			const root = resolve(config.modelPath);
			const target = resolve(join(root, relative));
			if (target !== root && !target.startsWith(root + sep)) {
				writeJson(res, 403, { code: "path_forbidden" });
				return;
			}
			let isFile: boolean;
			try {
				isFile = statSync(target).isFile();
			} catch {
				isFile = false;
			}
			if (!isFile || !serveFile(res, target, 3600)) {
				writeJson(res, 404, { code: "not_found" });
			}
		} })
	);

	// Cubism Core runtime (bundled with the plugin).
	const corePath = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/cubism4/live2dcubismcore.min.js");
	disposers.push(
		webServer.register({ kind: "exact", path: CORE_SCRIPT_PATH, handler: (_req, res) => {
			if (!serveFile(res, corePath, 86_400)) writeJson(res, 404, { code: "core_missing" });
		} })
	);

	// Load Cubism Core on every index.html render (pixi-live2d-display needs
	// window.Live2DCubismCore before the first model loads).
	disposers.push(
		ctx.on("webserver/index-inject", (table) => {
			table.push({ kind: "script-src", placement: "head", src: CORE_SCRIPT_PATH });
		})
	);

	return () => {
		for (const dispose of disposers) dispose();
	};
}
