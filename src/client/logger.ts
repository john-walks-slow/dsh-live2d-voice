/**
 * In-memory diagnostic logger and client-to-server error reporting for Live2D.
 *
 * Keeps a rolling ring buffer of the last 120 log entries in memory (inspectable
 * via `window.__LIVE2D_LOGS__` and `window.__getLive2dLogs()`), surfaces errors
 * to DevTools console, and ships warnings/errors asynchronously to the host
 * route `POST /live2d-voice/client-log` so server-side logs (`/var/log/dsh.log`)
 * capture client-side crashes, WebGL context loss, and unhandled rejections.
 */

export interface LogEntry {
	timestamp: number;
	time: string;
	level: "debug" | "info" | "warn" | "error";
	message: string;
	details?: unknown;
}

class ClientLogger {
	private readonly buffer: LogEntry[] = [];
	private readonly maxLogs = 120;
	private sessionId = "";
	private uploadTimer: number | null = null;
	private pendingUploads: Array<{ level: string; message: string; details?: unknown; timestamp: number }> = [];

	constructor() {
		if (typeof window !== "undefined") {
			(window as unknown as { __LIVE2D_LOGS__?: LogEntry[]; __getLive2dLogs?: () => string }).__LIVE2D_LOGS__ = this.buffer;
			(window as unknown as { __LIVE2D_LOGS__?: LogEntry[]; __getLive2dLogs?: () => string }).__getLive2dLogs = () => this.exportLogsText();
		}
	}

	setSessionId(id: string): void {
		this.sessionId = id;
	}

	private record(level: "debug" | "info" | "warn" | "error", message: string, details?: unknown) {
		const now = new Date();
		const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;
		const entry: LogEntry = {
			timestamp: Date.now(),
			time: timeStr,
			level,
			message,
			details,
		};
		this.buffer.push(entry);
		if (this.buffer.length > this.maxLogs) {
			this.buffer.shift();
		}

		// Console output
		const prefix = `[dsh-live2d:${level}]`;
		if (level === "error") {
			console.error(prefix, message, details ?? "");
		} else if (level === "warn") {
			console.warn(prefix, message, details ?? "");
		} else if (level === "info") {
			console.info(prefix, message, details ?? "");
		} else {
			console.debug(prefix, message, details ?? "");
		}

		// Upload warnings, errors, and key lifecycle milestones to host
		const isMilestone =
			message.includes("reload") ||
			message.includes("mount") ||
			message.includes("context lost") ||
			message.includes("crash");
		if (level === "warn" || level === "error" || isMilestone) {
			this.queueUpload(entry);
		}
	}

	private queueUpload(entry: LogEntry) {
		if (typeof window === "undefined" || typeof fetch !== "function") return;
		this.pendingUploads.push({
			level: entry.level,
			message: entry.message,
			details: entry.details,
			timestamp: entry.timestamp,
		});
		if (this.uploadTimer !== null) return;
		this.uploadTimer = window.setTimeout(() => {
			this.flushUploads();
		}, 600);
	}

	private flushUploads() {
		this.uploadTimer = null;
		if (this.pendingUploads.length === 0) return;
		const batch = this.pendingUploads.splice(0, 10);
		for (const item of batch) {
			try {
				void fetch("/live2d-voice/client-log", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						level: item.level,
						message: item.message,
						details: item.details,
						sessionId: this.sessionId,
						url: typeof window !== "undefined" ? window.location.href : "",
					}),
					keepalive: true,
				}).catch(() => undefined);
			} catch {}
		}
	}

	debug(message: string, details?: unknown): void {
		this.record("debug", message, details);
	}

	info(message: string, details?: unknown): void {
		this.record("info", message, details);
	}

	warn(message: string, details?: unknown): void {
		this.record("warn", message, details);
	}

	error(message: string, details?: unknown): void {
		this.record("error", message, details);
	}

	getLogs(): readonly LogEntry[] {
		return [...this.buffer];
	}

	exportLogsText(): string {
		const envInfo =
			typeof window !== "undefined"
				? `URL: ${window.location.href}\nUA: ${navigator.userAgent}\nDPR: ${window.devicePixelRatio}\nScreen: ${window.screen?.width ?? 0}x${window.screen?.height ?? 0}\nSession: ${this.sessionId || "(none)"}\n`
				: "";
		const lines = this.buffer.map((log) => {
			const det = log.details
				? ` | ${typeof log.details === "object" ? JSON.stringify(log.details) : String(log.details)}`
				: "";
			return `[${log.time}] [${log.level.toUpperCase()}] ${log.message}${det}`;
		});
		return `=== Live2D Diagnostic Logs ===\n${envInfo}Logs (${lines.length}):\n${lines.join("\n")}\n==============================`;
	}

	installGlobalErrorHandlers(): void {
		if (typeof window === "undefined") return;
		const w = window as unknown as { __live2d_errors_installed?: boolean };
		if (w.__live2d_errors_installed) return;
		w.__live2d_errors_installed = true;

		window.addEventListener("error", (e) => {
			this.error(`Uncaught script error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`, {
				error: e.error?.stack || String(e.error),
			});
		});

		window.addEventListener("unhandledrejection", (e) => {
			const reason = e.reason as { message?: string; stack?: string } | undefined;
			this.error(`Unhandled Promise rejection: ${reason?.message || String(reason)}`, {
				stack: reason?.stack,
			});
		});
	}
}

export const logger = new ClientLogger();
