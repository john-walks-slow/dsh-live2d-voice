/**
 * The "look at user" tool: the model can ask for a photo from the front
 * camera of the device showing the Live2D view.
 *
 * Flow: the tool executes on the host → SSE `camera-capture {requestId}` to
 * the session's Live view → the browser captures a frame (reusing the gaze
 * tracker's camera when active, else a short-lived stream) → POST
 * /live2d-voice/camera-result → the pending tool call resolves → the JPEG
 * goes through ctx.attachments.saveImage and returns to the model as an
 * image content block (with a text fallback for text-only models).
 *
 * Registration is agent-scoped and view-gated: the tool only exists for
 * sessions whose Live2D view has been opened — ordinary coding sessions
 * never see it. The execute-time hub check covers "view closed since".
 */

import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import type { SseHub } from "./events.js";

/** How long the browser has to deliver a frame before the tool errors. */
const CAPTURE_TIMEOUT_MS = 25_000;

interface CaptureShot {
	dataUrl: string;
	width: number;
	height: number;
}

/** Pending browser captures keyed by request id. */
export class CameraBridge {
	private pending = new Map<string, { resolve: (shot: CaptureShot | null) => void; timer: ReturnType<typeof setTimeout> }>();

	constructor(private hub: SseHub) {}

	/** Ask the session's Live view for a camera frame. Resolves null on timeout. */
	request(sessionId: string): Promise<CaptureShot | null> {
		return new Promise((resolve) => {
			const requestId = randomUUID().slice(0, 12);
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				resolve(null);
			}, CAPTURE_TIMEOUT_MS);
			this.pending.set(requestId, { resolve, timer });
			this.hub.emit(sessionId, "camera-capture", { requestId });
		});
	}

	/** The browser delivered (or failed) — called by the result route. */
	deliver(requestId: string, shot: CaptureShot | null): boolean {
		const entry = this.pending.get(requestId);
		if (!entry) return false;
		this.pending.delete(requestId);
		clearTimeout(entry.timer);
		entry.resolve(shot);
		return true;
	}
}

/** Minimal agent shape (avoids importing agent runtime internals). */
interface AgentLike {
	id: unknown;
	ctx: Context;
}

export function applyCameraTool(ctx: Context, hub: SseHub, bridge: CameraBridge): () => void {
	const registered = new WeakSet<object>();

	const registerOne = (agent: AgentLike) => {
		if (registered.has(agent)) return;
		registered.add(agent);
		agent.ctx.effect(() =>
			agent.ctx.tools.register(
				defineTool({
					name: "look_at_user",
					description:
						"Take one photo from the front camera of the device where the user is watching you (the Live2D voice view), so you can actually see the user and their surroundings. " +
						"Use it when the user asks you to look at them or at something near them（例如用户说「看看我」「你看我这边」）. " +
						"The photo is taken only with the browser's explicit camera permission on the user's own device. " +
						"Only available while the user has the Live2D view open; if it errors, tell the user you cannot see them right now.",
					parameters: {},
					output: {
						schema: {
							type: "object",
							additionalProperties: false,
							properties: {
								ok: { type: "boolean", required: true },
								error: { type: "string" },
								/** Opaque image attachment reference (on success). */
								ref: { type: "object", additionalProperties: true },
							},
						},
						render: (_args, value) => {
							if (!value.ok || !value.ref) {
								return [{ type: "text", text: `(拍照失败：${value.error ?? "未知错误"})` }];
							}
							return [
								{ type: "image", attachment: value.ref as unknown as ImageAttachmentRef },
								{ type: "text", text: "(一张刚从前置摄像头拍摄的照片)" },
							];
						},
					},
					async execute(_args, exec) {
						const sessionId = String((exec.agent as { id?: unknown } | undefined)?.id ?? "");
						if (!sessionId || !hub.has(sessionId)) {
							return { ok: false, error: "Live2D 视图未打开——用户现在看不到你，也无法拍照" };
						}
						const shot = await bridge.request(sessionId);
						if (!shot) return { ok: false, error: "摄像头不可用或超时未响应" };
						const base64 = shot.dataUrl.includes(",") ? shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1) : shot.dataUrl;
						const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
						const ref = await ctx.attachments.saveImage({
							data: bytes,
							mediaType: "image/jpeg",
							name: "camera.jpg",
						});
						return { ok: true, ref: ref as unknown as Record<string, never> };
					},
				}),
			),
		);
	};

	const offCreated = ctx.on("agent/created", (payload: unknown) => {
		// The event carries a { agent } wrapper.
		const a = (payload as { agent?: AgentLike }).agent;
		if (!a?.ctx || a.id === undefined) return;
		if (!hub.has(String(a.id))) return; // Live2D view not open → no tool
		registerOne(a);
	});
	const offFirstOpen = hub.onFirstOpen((sessionId) => {
		const agent = ctx.agents.get(sessionId as never) as unknown as AgentLike | undefined;
		if (agent?.ctx) registerOne(agent);
	});

	return () => {
		offCreated();
		offFirstOpen();
	};
}
