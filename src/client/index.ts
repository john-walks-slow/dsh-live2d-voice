/**
 * Browser half of dsh-live2d-voice: the "Live2D" conversation view tab.
 *
 * Registering on the conversation.view slot adds a tab beside Chat /
 * Trajectory. Message submission goes through the GUI session channel
 * (ctx.sessions → SessionFace.prompt → session/prompt RPC), which works for
 * cold sessions too — the host creates or resumes the agent server-side.
 * Mounting problems are logged, never thrown — an external plugin must not
 * take the GUI down.
 */

import type { ClientContext, ISessions, SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { injectLiveStyles } from "./styles.js";
import { makeLive2DView } from "./view.js";

export const inject = ["slots", "sessions"];

export function apply(ctx: ClientContext): void {
	injectLiveStyles();
	try {
		// The browser runtime's sessions face. Cast needed: the host-side
		// dsh-session types also merge `Context.sessions` (SessionStore) and,
		// with skipLibCheck, that declaration wins the merge order in this
		// compilation — the runtime value in the browser is ISessions.
		const sessions = ctx.sessions as unknown as ISessions;

		// Submit through the same channel the Chat composer uses, so the host
		// handles agent creation/resume, attribution and queueing for us.
		const submitPrompt = (sessionId: string, text: string, mode: "queue" | "steer" = "queue") => {
			const binding = sessions.binding?.(sessionId as SessionId);
			const session = binding?.session;
			if (!session) return undefined;
			return session
				.prompt([{ type: "text", text }], mode)
				.then((result) =>
					result.ok
						? { ok: true as const }
						: { ok: false as const, error: String((result.error as { message?: string })?.message ?? result.error) },
				)
				.catch((error: unknown) => ({ ok: false as const, error: String((error as Error)?.message ?? error) }));
		};

		ctx.slots.inject("conversation.view", () =>
			ctx.slots.register(
				{
					name: "conversation.view",
					id: "live2d",
					order: 10,
					label: "Live2D",
				},
				makeLive2DView(submitPrompt)
			)
		);
		console.info("[dsh-live2d-voice] Live2D view mounted");
	} catch (error) {
		console.error("[dsh-live2d-voice] conversation.view registration failed", error);
	}
}
