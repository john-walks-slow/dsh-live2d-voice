/**
 * The "Live" entry button — rendered inside the input bar
 * (`conversation.input.right`).
 *
 * On the hero / blank-session page the header (and its tabs) are hidden by
 * DSH, so this button is the only way in: clicking it calls the host
 * `/live2d-voice/enter-live` route, which injects a minimal "Enter live
 * mode." system-style activation message and immediately cancels the turn —
 * the session leaves its blank state (so DSH renders views for it) but the
 * model generates no reply. The Live2D speech-format system prompt is
 * injected automatically once the view's SSE stream is up.
 *
 * On active sessions the button hides itself (the header tablist exists, so
 * the Live2D tab is the normal way to switch). The button shows a "selected"
 * visual state only while the Live2D tab is the active view.
 *
 * Implementation note: child slot entries do not receive the parent's
 * `selectView` injection, so we rely on DOM queries — finding the tab by its
 * `role="tab"` + text content and checking its `aria-selected` attribute.
 */

import { useState, useEffect, useCallback, type FC } from "react";

/** A compact live-character icon (a simplified face with a broadcast dot). */
const IconLive: FC<{ size?: number }> = ({ size = 16 }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.8}
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		{/* face outline */}
		<circle cx="12" cy="12" r="9" />
		{/* eyes */}
		<circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
		<circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
		{/* smile */}
		<path d="M9 14.5c1 1 5 1 6 0" />
	</svg>
);

interface LiveButtonProps {
	/** Current session id (from standard session slot props). */
	sessionId?: string;
}

/** Check if a tab element's text matches "Live2D" or "Live". */
function isLive2DTab(tab: HTMLElement): boolean {
	const text = tab.textContent?.trim() ?? "";
	return text === "Live2D" || text === "Live";
}

/** Check if a tab element is currently selected. */
function isTabSelected(tab: HTMLElement): boolean {
	return tab.getAttribute("aria-selected") === "true";
}

/** Find the Live2D tab element, or null if not found. */
function findLive2DTab(): HTMLElement | null {
	const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]');
	for (const tab of Array.from(tabs)) {
		if (isLive2DTab(tab)) return tab;
	}
	return null;
}

/** Check whether the Live2D tab is the currently active view. */
function isLive2DActive(): boolean {
	const tab = findLive2DTab();
	return tab !== null && isTabSelected(tab);
}

/** Find the first non-Live2D tab (for exit). */
function findFirstOtherTab(): HTMLElement | null {
	const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]');
	for (const tab of Array.from(tabs)) {
		if (!isLive2DTab(tab)) return tab;
	}
	return null;
}

/** Poll for the Live2D tab to appear in the DOM, then click it. */
function clickLive2DTabWhenReady(timeoutMs = 8000): void {
	const deadline = Date.now() + timeoutMs;
	const timer = window.setInterval(() => {
		const tab = findLive2DTab();
		if (tab) {
			window.clearInterval(timer);
			tab.click();
		} else if (Date.now() > deadline) {
			window.clearInterval(timer);
		}
	}, 200);
}

/** Ask the host to activate the session without generating a reply. */
async function enterLiveMode(sessionId: string): Promise<void> {
	const response = await fetch("/live2d-voice/enter-live", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId }),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { message?: string };
		throw new Error(body.message ?? `HTTP ${response.status}`);
	}
}

export const LiveButton: FC<LiveButtonProps> = (props) => {
	const [active, setActive] = useState(false);
	const [entering, setEntering] = useState(false);
	const [hasTabs, setHasTabs] = useState(false);

	// Poll the DOM: track whether the header tablist exists (active session)
	// and whether the Live2D tab is the current view.
	useEffect(() => {
		const check = () => {
			setHasTabs(document.querySelector('[role="tablist"]') !== null);
			setActive(isLive2DActive());
		};
		check();
		const timer = window.setInterval(check, 400);
		return () => window.clearInterval(timer);
	}, []);

	const handleClick = useCallback(() => {
		// Active session with visible tabs: the LiveButton only shows on the
		// hero page, but when it is visible and a tab exists (e.g. just after
		// activation), fall back to a direct tab click instead of re-injecting.
		if (findLive2DTab()) {
			if (isLive2DActive()) {
				findFirstOtherTab()?.click();
			} else {
				findLive2DTab()?.click();
			}
			return;
		}
		// Hero / blank page: activate the session without generating, then
		// poll for the Live2D tab (which appears once DSH renders views) and
		// click it.
		const sid = props.sessionId;
		if (!sid) return;
		setEntering(true);
		void enterLiveMode(sid)
			.then(() => clickLive2DTabWhenReady())
			.catch(() => clickLive2DTabWhenReady())
			.finally(() => window.setTimeout(() => setEntering(false), 2000));
	}, [props.sessionId]);

	// Hide entirely on active sessions — the header tablist is the normal way
	// in. Only render on hero/blank sessions (or in the brief window where
	// the session just activated but the poll hasn't re-rendered yet).
	if (hasTabs && !active) return null;

	return (
		<button
			type="button"
			className="lv-live-entry"
			data-pressed={active || undefined}
			aria-pressed={active}
			disabled={entering}
			title={active ? "退出 Live2D 视图" : "进入 Live2D 角色对话模式"}
			onClick={handleClick}
		>
			<IconLive size={15} />
			<span>{entering ? "…" : "Live"}</span>
		</button>
	);
};
