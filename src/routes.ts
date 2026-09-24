/**
 * Web routes on the host webserver (composed dsh web profiles only; a missing
 * webserver degrades to a no-op with one log line):
 *
 *   GET  /live2d-voice/stream?session=<id>   SSE event stream (the Live view)
 *   POST /live2d-voice/asr/recognize?lang=.. one buffered utterance of 16k
 *                                           PCM in (octet-stream), text out
 *   GET  /live2d-voice/config[?session=..]   sanitized config + voice presets
 *                                           (with session: the workspace-
 *                                            overlaid effective config)
 *   POST /live2d-voice/config                update config fields (global)
 *   POST /live2d-voice/message               submit a user message to a session
 *   GET  /live2d-voice/model[?session=..]   which .model3.json to render +
 *                                           the full model catalog
 *   GET  /live2d-voice/models/*              model assets (traversal-guarded)
 *   GET  /live2d-voice/core/live2dcubismcore.min.js  Cubism Core runtime
 *
 * Plus a `webserver/index-inject` row loading the Cubism Core script on every
 * index.html render (the model loader requires window.Live2DCubismCore).
 */

import { readFileSync, statSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { LANGUAGE_OPTIONS, VOICE_PRESETS, resolveModelCatalog, resolveModelSelection, resolveSessionConfig, type ModelEntry, type PluginConfig } from "./config.js";
import type { SseHub } from "./events.js";
import { loadVolcCredentials, recognizeUtterance } from "./asr.js";

const BODY_MAX_BYTES = 64 * 1024;
/** 16kHz s16le mono ≈ 32KB/s — 2MB ≈ one minute of speech, far above the client's 20s cap. */
const PCM_MAX_BYTES = 2 * 1024 * 1024;
/** Below 100ms of audio the recognizer has nothing to work with. */
const PCM_MIN_BYTES = 3200;
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

/** Read a raw binary request body (bounded). */
async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBytes) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/** The sanitized config served to the GUI: API keys never leave the host. */
function publicConfig(config: PluginConfig, keyCount: number) {
	const { apiKeys: _apiKeys, ...rest } = config;
	const asrConfigured = config.asrCredentialsFile
		? loadVolcCredentials(config.asrCredentialsFile) !== undefined
		: false;
	return { ...rest, apiKeyCount: keyCount, asrConfigured };
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

/** The asset URL of a catalog entry (each path segment encoded). */
function modelUrl(entry: ModelEntry): string {
	return `${MODELS_PREFIX}/${entry.relative.split("/").map(encodeURIComponent).join("/")}`;
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

	// Speech-to-text: one VAD-closed utterance (16k s16le mono PCM body) in,
	// transcript JSON out. Each request drives its own short-lived upstream
	// session, so concurrent utterances are naturally isolated.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/asr/recognize", handler: (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void (async () => {
				const config = deps.getConfig();
				const credentials = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) : undefined;
				if (credentials === undefined) {
					writeJson(res, 500, { ok: false, error: "未配置火山 ASR 凭证（live2d-voice.json → asrCredentialsFile，JSON 需含 apikey 或 appid+accessToken）" });
					return;
				}
				const language = new URL(req.url ?? "/", "http://localhost").searchParams.get("lang")?.trim() || config.sttLanguage || "auto";
				let pcm: Buffer;
				try {
					pcm = await readRawBody(req, PCM_MAX_BYTES);
				} catch (error) {
					writeJson(res, 413, { ok: false, error: error instanceof Error ? error.message : String(error) });
					return;
				}
				if (pcm.length < PCM_MIN_BYTES) {
					writeJson(res, 400, { ok: false, error: "音频过短（不足 100ms）" });
					return;
				}
				const text = await recognizeUtterance(credentials, pcm, language);
				writeJson(res, 200, { ok: true, text });
			})().catch((error: unknown) => {
				writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
			});
		} })
	);

	// Config read (sanitized) + write.
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/config", handler: (req, res) => {
			if (req.method === "GET") {
				const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
				const global = deps.getConfig();
				const config = sessionId
					? resolveSessionConfig(ctx.agents, global, sessionId)
					: global;
				writeJson(res, 200, {
					config: publicConfig(config, deps.resolveKeys(global).length),
					presets: VOICE_PRESETS,
					languages: LANGUAGE_OPTIONS,
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			void readJsonBody(req)
				.then((body) => {
					const patch: Partial<PluginConfig> = {};
					for (const key of ["modelPath", "modelSelection", "voiceId", "ttsModel", "apiKeyFile", "sttLanguage", "asrCredentialsFile", "speechLanguage", "subtitleLanguage", "speechPrompt"] as const) {
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

	// Model descriptor for the view: the effective selection plus the whole
	// catalog (the ⚙ panel offers a picker when there is more than one).
	disposers.push(
		webServer.register({ kind: "exact", path: "/live2d-voice/model", handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { code: "method_not_allowed" });
				return;
			}
			const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
			const config = sessionId
				? resolveSessionConfig(ctx.agents, deps.getConfig(), sessionId)
				: deps.getConfig();
			const catalog = resolveModelCatalog(config);
			const entry = resolveModelSelection(config, catalog);
			if (entry === undefined) {
				writeJson(res, 200, { configured: Boolean(config.modelPath), url: undefined });
				return;
			}
			writeJson(res, 200, {
				configured: true,
				url: modelUrl(entry),
				name: entry.name,
				current: entry.name,
				models: catalog.map((model) => ({ name: model.name, url: modelUrl(model) })),
			});
		} })
	);

	// Model assets (traversal-guarded static file serving). Roots include
	// every workspace-overridden modelPath so catalog URLs generated against
	// an override root actually resolve (override roots win, global last).
	disposers.push(
		webServer.register({ kind: "prefix", path: MODELS_PREFIX, handler: (req, res) => {
			const config = deps.getConfig();
			const roots: string[] = [];
			for (const override of Object.values(config.workspaces ?? {})) {
				const path = typeof override.modelPath === "string" ? override.modelPath.trim() : "";
				if (path && !roots.includes(resolve(path))) roots.push(resolve(path));
			}
			if (config.modelPath && !roots.includes(resolve(config.modelPath))) roots.push(resolve(config.modelPath));
			if (roots.length === 0) {
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
			for (const root of roots) {
				const target = resolve(join(root, relative));
				if (target !== root && !target.startsWith(root + sep)) continue; // wrong root — try next
				let isFile: boolean;
				try {
					isFile = statSync(target).isFile();
				} catch {
					isFile = false;
				}
				if (isFile && serveFile(res, target, 3600)) return;
			}
			writeJson(res, 404, { code: "not_found" });
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
