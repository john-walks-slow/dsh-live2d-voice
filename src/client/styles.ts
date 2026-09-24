/**
 * View styles, injected once per page as a single <style> tag (the dsh web
 * app owns the document; plugin CSS arrives via JS to avoid asset plumbing).
 */

const CSS = `
.lv-root {
	position: absolute;
	inset: 0;
	overflow: hidden;
	background: radial-gradient(ellipse at 50% 28%, #232742 0%, #12131f 55%, #0b0c14 100%);
}
.lv-stage { position: absolute; inset: 0; }
.lv-stage canvas { display: block; }

/* ---------- HUD capsule ---------- */
.lv-hud {
	position: absolute;
	bottom: 84px;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px;
	border-radius: 999px;
	background: rgba(18, 20, 32, 0.78);
	backdrop-filter: blur(12px);
	border: 1px solid rgba(255, 255, 255, 0.09);
	box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
	transition: opacity 0.45s ease;
	z-index: 9;
}
.lv-hud.lv-faded { opacity: 0.16; }
.lv-hud.lv-faded:hover { opacity: 1; }
.lv-btn {
	width: 38px;
	height: 38px;
	border-radius: 50%;
	border: none;
	background: transparent;
	color: #cdd2e4;
	font-size: 17px;
	line-height: 1;
	cursor: pointer;
	display: grid;
	place-items: center;
	transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.lv-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.lv-btn:active { transform: scale(0.94); }
.lv-btn.lv-on { color: #7ab8ff; background: rgba(96, 150, 255, 0.14); }
.lv-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.lv-hud-sep { width: 1px; height: 22px; margin: 0 3px; background: rgba(255, 255, 255, 0.12); }

/* ---------- voice popover ---------- */
.lv-pop {
	position: absolute;
	bottom: calc(100% + 10px);
	right: 0;
	width: 250px;
	padding: 10px;
	border-radius: 14px;
	background: rgba(18, 20, 32, 0.94);
	backdrop-filter: blur(14px);
	border: 1px solid rgba(255, 255, 255, 0.1);
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
	color: #dfe3f0;
	font-size: 13px;
	z-index: 9;
}
.lv-pop h4 { margin: 2px 4px 8px; font-size: 12px; font-weight: 600; color: #9aa3bd; letter-spacing: 0.04em; }
.lv-voice {
	display: flex;
	justify-content: space-between;
	align-items: center;
	width: 100%;
	padding: 8px 10px;
	border: none;
	border-radius: 9px;
	background: transparent;
	color: #dfe3f0;
	font-size: 13px;
	cursor: pointer;
	text-align: left;
}
.lv-voice:hover { background: rgba(255, 255, 255, 0.08); }
.lv-voice.lv-current { color: #7ab8ff; background: rgba(96, 150, 255, 0.12); }
.lv-pop-note { margin: 8px 4px 0; color: #8a91a8; font-size: 11.5px; line-height: 1.5; }
.lv-prompt-input {
	width: 100%;
	box-sizing: border-box;
	margin: 2px 0 6px;
	padding: 8px;
	border-radius: 10px;
	border: 1px solid rgba(255, 255, 255, 0.12);
	background: rgba(255, 255, 255, 0.06);
	color: #dfe3f0;
	font-size: 12.5px;
	font-family: inherit;
	line-height: 1.5;
	resize: vertical;
	min-height: 56px;
}
.lv-prompt-input:focus { outline: none; border-color: rgba(159, 193, 255, 0.5); }
.lv-prompt-save {
	width: 100%;
	padding: 7px 0;
	border-radius: 10px;
	border: 1px solid rgba(255, 255, 255, 0.14);
	background: rgba(255, 255, 255, 0.08);
	color: #dfe3f0;
	font-size: 12.5px;
	cursor: pointer;
}
.lv-prompt-save:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
.lv-prompt-save:disabled { opacity: 0.45; cursor: default; }
.lv-pop-note.lv-warn { color: #e8b26a; }

/* ---------- subtitles ---------- */
.lv-subs {
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	bottom: 146px;
	width: min(72%, 640px);
	text-align: center;
	z-index: 4;
	pointer-events: none;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.lv-sub {
	color: #f0f2fa;
	text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.9);
	font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
	transition: opacity 0.6s ease;
}
.lv-sub.lv-old { font-size: 12.5px; opacity: 0.45; }
.lv-sub.lv-cur { font-size: 17px; opacity: 1; }
.lv-sub.lv-user { color: #9fc1ff; }
.lv-sub-tr {
	display: block;
	margin-top: 1px;
	font-size: 0.82em;
	opacity: 0.78;
}
.lv-sub.lv-err { color: #e8968a; font-size: 12.5px; }

/* ---------- voice input ---------- */
.lv-micbar {
	position: absolute;
	bottom: 196px;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 14px;
	border-radius: 999px;
	background: rgba(18, 20, 32, 0.88);
	backdrop-filter: blur(12px);
	border: 1px solid rgba(255, 120, 120, 0.25);
	color: #dfe3f0;
	font-size: 13px;
	z-index: 8;
	max-width: min(86%, 560px);
}
.lv-micdot {
	width: 9px;
	height: 9px;
	border-radius: 50%;
	background: #ff5f5f;
	box-shadow: 0 0 8px rgba(255, 95, 95, 0.8);
	animation: lv-pulse 1.2s ease-in-out infinite;
	flex: none;
}
.lv-micdot.lv-muted-dot {
	background: #8a91a8;
	box-shadow: none;
	animation: none;
}
.lv-mic-label {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 340px;
}
.lv-mic-meter {
	width: 72px;
	height: 5px;
	border-radius: 3px;
	background: rgba(255, 255, 255, 0.12);
	overflow: hidden;
	flex: none;
}
.lv-mic-fill {
	display: block;
	height: 100%;
	border-radius: 3px;
	background: linear-gradient(90deg, #7fd4a0, #ffd479, #ff5f5f);
	transition: width 80ms linear;
}
.lv-btn.lv-mic-live {
	color: #ff5f5f;
	box-shadow: 0 0 12px rgba(255, 95, 95, 0.45);
	animation: lv-pulse 1.2s ease-in-out infinite;
}
@keyframes lv-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.45; }
}

/* ---------- language pills ---------- */
.lv-langs {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 2px 0 8px;
}
.lv-lang {
	padding: 5px 10px;
	border-radius: 999px;
	border: 1px solid rgba(255, 255, 255, 0.14);
	background: rgba(255, 255, 255, 0.06);
	color: #c6cddd;
	font-size: 12px;
	cursor: pointer;
}
.lv-lang:hover { background: rgba(255, 255, 255, 0.12); }
.lv-lang.lv-current {
	background: rgba(159, 193, 255, 0.22);
	border-color: rgba(159, 193, 255, 0.55);
	color: #e8f0ff;
}

/* ---------- small screens ---------- */
@media (max-width: 640px) {
	.lv-subs { width: min(92%, 640px); }
	.lv-input { width: min(92%, 640px); }
	.lv-toast { max-width: 92%; }
	.lv-pop { width: min(88vw, 300px); }
}

/* ---------- text input ---------- */
.lv-input {
	position: absolute;
	bottom: 196px;
	left: 50%;
	transform: translateX(-50%);
	width: min(72%, 640px);
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 8px;
	border-radius: 16px;
	background: rgba(18, 20, 32, 0.88);
	backdrop-filter: blur(12px);
	border: 1px solid rgba(255, 255, 255, 0.12);
	z-index: 9;
}
.lv-input input {
	flex: 1;
	border: none;
	background: transparent;
	color: #eef0f8;
	font-size: 14px;
	padding: 6px 8px;
	outline: none;
}
.lv-input button {
	border: none;
	border-radius: 10px;
	padding: 7px 14px;
	background: #3d6fd6;
	color: #fff;
	font-size: 13px;
	cursor: pointer;
}
.lv-input button:hover { background: #4c7ce4; }
.lv-input button:disabled { opacity: 0.5; }

/* ---------- overlays / toast ---------- */
.lv-center {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	z-index: 3;
	pointer-events: none;
}
.lv-card {
	padding: 18px 26px;
	border-radius: 16px;
	background: rgba(16, 18, 28, 0.82);
	border: 1px solid rgba(255, 255, 255, 0.08);
	color: #c6ccdf;
	font-size: 13.5px;
	text-align: center;
	line-height: 1.7;
	max-width: 420px;
}
.lv-card b { color: #eef0f8; }
.lv-toast {
	position: absolute;
	bottom: 146px;
	left: 50%;
	transform: translateX(-50%);
	padding: 9px 16px;
	border-radius: 12px;
	background: rgba(60, 28, 28, 0.92);
	border: 1px solid rgba(232, 150, 138, 0.35);
	color: #f0c9c2;
	font-size: 12.5px;
	z-index: 10;
	max-width: 72%;
}
`;

let injected = false;

export function injectLiveStyles(): void {
	if (injected || typeof document === "undefined") return;
	injected = true;
	const style = document.createElement("style");
	style.id = "dsh-live2d-voice-styles";
	style.textContent = CSS;
	document.head.appendChild(style);
}
