/**
 * Standalone Live2D entry: one session, one character, no GUI chrome.
 *
 * Opened as /live2d-voice/app?session=<id> (auth via the dsh web session).
 * The page reuses the whole Live view (stage, voice input, subtitles,
 * settings, fullscreen, experimental features) and submits through the
 * plugin's own POST /live2d-voice/message route — which cold-resumes the
 * session on the host, so the page truly stands alone.
 *
 * Known v1.3 limitation: the host message route uses agent.followup (queue
 * semantics) — while a turn is playing, barge-in stops the audio and the new
 * line is queued rather than steering the running turn.
 */

import { createRoot } from "react-dom/client";
import type { FC } from "react";
import { postMessage } from "./api.js";
import { injectLiveStyles } from "./styles.js";
import { makeLive2DView, type SubmitPrompt } from "./view.js";
import { logger } from "./logger.js";

injectLiveStyles();
logger.installGlobalErrorHandlers();

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session")?.trim() ?? "";

const submitPrompt: SubmitPrompt = (sid, text, mode) => {
	if (sid !== sessionId) return undefined;
	return postMessage(sid, text, mode)
		// remoteEcho: the /message route emits the user subtitle over the
		// session SSE — the view must not also push it locally (double card).
		.then(() => ({ ok: true as const, remoteEcho: true }))
		.catch((error: unknown) => ({ ok: false as const, error: String((error as Error)?.message ?? error) }));
};

function StandaloneApp() {
	if (!sessionId) {
		return (
			<div className="lv-root" data-no-gesture>
				<div className="lv-center">
					<div className="lv-card">
						<b>缺少会话参数</b>
						<br />
						在 URL 后加 <b>?session=&lt;会话 id&gt;</b> 打开某个会话的 Live2D 角色页。
						<br />
						会话 id 可在完整界面的会话详情中找到。
					</div>
				</div>
			</div>
		);
	}
	// The GUI provides useSession/useProjection/useInput/inputActions; the
	// standalone page has no host runtime, and the Live view only consumes
	// sessionId + submitPrompt — narrow the component type accordingly.
	const View = makeLive2DView(submitPrompt) as FC<{ sessionId: string; standalone?: boolean }>;
	return <View sessionId={sessionId} standalone />;
}

const container = document.getElementById("root");
if (container !== null) createRoot(container).render(<StandaloneApp />);
