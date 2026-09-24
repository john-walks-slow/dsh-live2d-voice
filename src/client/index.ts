/**
 * Browser half of dsh-live2d-voice:
 *   - "conversation.view" tab: Live2D session view
 *   - "settings.section": Global Live2D & Voice configuration panel
 */

import type { ClientContext, ISessions, SessionId } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { injectLiveStyles } from "./styles.js";
import { makeLive2DView } from "./view.js";
import { Live2DSettingsSection } from "./settings-section.js";
import { LiveButton } from "./live-button.js";

export const inject = ["slots", "sessions"];

export function apply(ctx: ClientContext): void {
	injectLiveStyles();

	// 1. Register Live2D view tab
	try {
		const sessions = ctx.sessions as unknown as ISessions;

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

	// 2. Register Live2D Global Settings Section
	try {
		const slots = ctx.slots as unknown as {
			inject: (name: string, fn: () => void) => void;
			register: (spec: Record<string, unknown>, component: unknown) => void;
		};
		slots.inject("settings.section", () =>
			slots.register(
				{
					name: "settings.section",
					id: "live2d-voice",
					order: 130,
					label: () => "Live2D 角色与语音",
				},
				Live2DSettingsSection
			)
		);
		console.info("[dsh-live2d-voice] settings.section mounted");
	} catch (error) {
		console.error("[dsh-live2d-voice] settings.section registration failed", error);
	}

	// 3. Register the "Live" entry button inside the input bar
	//    (conversation.input.right). It is visible on the hero/new-session
	//    page (where the header and its tabs are hidden) and self-hides on
	//    active sessions once the header tablist exists — see LiveButton.
	try {
		ctx.slots.inject("conversation.input.right", () =>
			ctx.slots.register(
				{
					name: "conversation.input.right",
					id: "live2d-enter",
					order: 200,
				},
				LiveButton
			)
		);
		console.info("[dsh-live2d-voice] input.right Live button mounted");
	} catch (error) {
		console.error("[dsh-live2d-voice] input.right Live button registration failed", error);
	}
}
