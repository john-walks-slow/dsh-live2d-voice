/**
 * Per-session SSE hub.
 *
 * The Live2D view opens one EventSource per session
 * (GET /live2d-voice/stream?session=<id>). The hub tracks connected sessions
 * so the llm/stream tap only synthesizes speech for sessions that are
 * actually being watched, and fans events out to every listener of a session.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export type SseEventName =
	| "expression"
	| "motion"
	| "speech-start"
	| "speech-end"
	| "audio-start"
	| "audio"
	| "audio-end"
	| "subtitle"
	| "subtitle-translation"
	| "camera-capture"
	| "asr-interim"
	| "asr-final"
	| "error"
	| "hello";

export interface SseConnection {
	sessionId: string;
	send: (event: SseEventName, data: unknown) => void;
	close: () => void;
}

const HEARTBEAT_MS = 15_000;

export class SseHub {
	private connections = new Map<string, Set<SseConnection>>();
	private lastCloseListeners = new Set<(sessionId: string) => void>();
	private firstOpenListeners = new Set<(sessionId: string) => void>();

	/**
	 * Register a callback fired when a session's LAST connection closes —
	 * the Live view is gone, so in-flight work for it should be aborted.
	 */
	onLastClose(listener: (sessionId: string) => void): () => void {
		this.lastCloseListeners.add(listener);
		return () => this.lastCloseListeners.delete(listener);
	}

	/** Register a callback fired when a session's FIRST connection opens. */
	onFirstOpen(listener: (sessionId: string) => void): () => void {
		this.firstOpenListeners.add(listener);
		return () => this.firstOpenListeners.delete(listener);
	}

	/** Whether at least one Live view listens on this session (speech gate). */
	has(sessionId: string): boolean {
		return (this.connections.get(sessionId)?.size ?? 0) > 0;
	}

	attach(sessionId: string, req: IncomingMessage, res: ServerResponse): SseConnection {
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "keep-alive",
		});
		let closed = false;
		const connection: SseConnection = {
			sessionId,
			send: (event, data) => {
				if (closed || res.writableEnded) return;
				res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
			},
			close: () => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				const set = this.connections.get(sessionId);
				if (set) {
					set.delete(connection);
					if (set.size === 0) {
					this.connections.delete(sessionId);
					for (const listener of this.lastCloseListeners) listener(sessionId);
				}
				}
				try {
					res.end();
				} catch {
					/* socket already gone */
				}
			},
		};
		const heartbeat = setInterval(() => {
			if (closed || res.writableEnded) return;
			res.write(": keepalive\n\n");
		}, HEARTBEAT_MS);
		req.on("close", () => connection.close());
		res.on("close", () => connection.close());
		let set = this.connections.get(sessionId);
		if (!set) {
			set = new Set();
			this.connections.set(sessionId, set);
		}
		const wasEmpty = set.size === 0;
		set.add(connection);
		if (wasEmpty) for (const listener of this.firstOpenListeners) listener(sessionId);
		res.write(": connected\n\n");
		connection.send("hello", { sessionId });
		return connection;
	}

	emit(sessionId: string, event: SseEventName, data: unknown): void {
		const set = this.connections.get(sessionId);
		if (!set) return;
		for (const connection of set) connection.send(event, data);
	}
}
