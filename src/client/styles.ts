/**
 * Live2D Voice plugin design system styles.
 * Driven entirely by DSH host CSS variables (--dsw-alias-*) with graceful fallbacks.
 * Fully responsive across light / dark themes, desktop, mobile viewports and fullscreen.
 */

const CSS = `
/* ==========================================================================
   1. Design Tokens & Semantic Variables Layer
   ========================================================================== */
.lv-root {
	/* Palette mapped to DSH host aliases */
	--lv-fg:            var(--dsw-alias-label-primary, #0f1115);
	--lv-fg-2:          var(--dsw-alias-label-secondary, #61666b);
	--lv-fg-3:          var(--dsw-alias-label-tertiary, #81858c);
	--lv-fg-caption:    var(--dsw-alias-label-caption, #adb2b8);
	--lv-accent:        var(--dsw-alias-state-business-primary, #4176e6);
	--lv-accent-soft:   var(--dsw-alias-state-business-tertiary, #e4edfd);
	--lv-success:       var(--dsw-alias-state-success-primary, #22c55e);
	--lv-warn:          var(--dsw-alias-state-warn-label, #f59e0b);
	--lv-danger:        var(--dsw-alias-state-error-primary, #ec1313);
	--lv-base:          var(--dsw-alias-bg-base, #ffffff);
	--lv-surface:       var(--dsw-alias-bg-layer-2, #ffffff);
	--lv-surface-2:     var(--dsw-alias-bg-layer-3, #ffffff);
	--lv-border:        var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10));
	--lv-border-soft:   var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.05));
	--lv-hover:         var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
	--lv-active:        var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.10));
	--lv-toast-bg:      var(--dsw-alias-toast-bg, #353638);
	--lv-shadow-panel:  var(--dsw-elevation-panel, 0 0 0 0.5px rgba(0,0,0,0.04), 0 3px 8px rgba(0,0,0,0.03), 0 0 16px rgba(0,0,0,0.02));
	--lv-shadow-pop:    var(--dsw-elevation-prominent, 0 0 0 0.5px rgba(0,0,0,0.06), 0 6px 16px rgba(0,0,0,0.08), 0 0 24px rgba(0,0,0,0.05));
	--lv-font:          var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);

	/* Glassmorphism token */
	--lv-glass-bg:      color-mix(in srgb, var(--lv-surface-2) 75%, transparent);
	--lv-glass-border:  var(--lv-border);
	--lv-glass-blur:    saturate(1.4) blur(16px);

	/* Dynamic bottom clearance: now that host composer & task overlays are hidden,
	   keep clean breathing room at the bottom of the viewport/stage. */
	--lv-chrome-bottom: 20px;

	position: absolute;
	inset: 0;
	overflow: hidden;
	user-select: none;
	background: var(--lv-base);
	font-family: var(--lv-font);
	color: var(--lv-fg);
	transition: background 0.3s ease;
}

/* Dark mode adjustments */
body[data-ds-dark-theme] .lv-root,
.lv-root.lv-dark {
	--lv-fg:            var(--dsw-alias-label-primary, #f9fafb);
	--lv-fg-2:          var(--dsw-alias-label-secondary, #9ca3af);
	--lv-fg-3:          var(--dsw-alias-label-tertiary, #6b7280);
	--lv-base:          var(--dsw-alias-bg-base, #151517);
	--lv-surface:       var(--dsw-alias-bg-layer-2, #1c1d21);
	--lv-surface-2:     var(--dsw-alias-bg-layer-3, #23252a);
	--lv-border:        var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
	--lv-border-soft:   var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
	--lv-hover:         var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
	--lv-active:        var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.14));
	--lv-glass-bg:      color-mix(in srgb, var(--lv-surface-2) 65%, transparent);
}

/* ==========================================================================
   2. Stage, Ambient Halo & Ground Shadow
   ========================================================================== */
/* Hide host composer & task overlays when Live2D is active */
body:has(.lv-root) .wSkVaW_composerSeat,
body:has(.lv-root) [data-composer-seat],
body:has(.lv-root) [class*="composerSeat"],
body[data-live2d-active="true"] .wSkVaW_composerSeat,
body[data-live2d-active="true"] [data-composer-seat],
body[data-live2d-active="true"] [class*="composerSeat"],
body[data-live2d-active="true"] [class*="task-board"],
body[data-live2d-active="true"] [class*="taskBoard"] {
	display: none !important;
}

.lv-ambient {
	position: absolute;
	inset: 0;
	pointer-events: none;
	background:
		radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--lv-accent) 8%, transparent), transparent 65%),
		radial-gradient(60% 55% at 50% 48%, color-mix(in srgb, var(--lv-accent) 6%, transparent), transparent 75%);
}

.lv-stage {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	display: block;
	touch-action: none;
}

.lv-stage canvas {
	width: 100% !important;
	height: 100% !important;
	display: block;
}

/* ==========================================================================
   3. Subtitle Cards (Refined Glass Overlay)
   ========================================================================== */
.lv-subs {
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	bottom: calc(var(--lv-chrome-bottom) + 72px);
	width: min(76%, 660px);
	text-align: center;
	z-index: 4;
	pointer-events: none;
	display: flex;
	flex-direction: column;
	gap: 6px;
	transition: bottom 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.lv-subs.lv-subs-raised {
	bottom: calc(var(--lv-chrome-bottom) + 128px);
}

.lv-sub-card {
	padding: 10px 16px;
	border-radius: 16px;
	background: color-mix(in srgb, var(--lv-surface) 65%, transparent);
	backdrop-filter: blur(14px);
	border: 1px solid var(--lv-border-soft);
	box-shadow: var(--lv-shadow-panel);
	color: var(--lv-fg);
	display: inline-block;
	max-width: 100%;
	margin: 0 auto;
	animation: lv-sub-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1);
	will-change: transform, opacity;
}

/* Third-person: transient "酝酿中…" placeholder while the player line is
   being polished — grayed, italic, clearly not a real line yet. */
.lv-sub-pending {
	opacity: 0.55;
	font-style: italic;
}

/* Third-person: the player avatar's lines carry a small "你" badge so the
   two characters stay distinguishable at a glance. */
.lv-sub-speaker {
	display: inline-block;
	font-size: 10px;
	font-weight: 600;
	line-height: 1;
	padding: 3px 5px;
	margin-right: 8px;
	vertical-align: -0.1em;
	border-radius: 6px;
	background: color-mix(in srgb, var(--lv-accent) 18%, transparent);
	color: var(--lv-accent);
}


.lv-sub-old {
	font-size: 13px;
	opacity: 0.55;
	padding: 4px 12px;
	background: transparent;
	border: none;
	box-shadow: none;
	backdrop-filter: none;
	transition: opacity 0.25s ease, transform 0.25s ease;
}

.lv-sub-user {
	border-color: color-mix(in srgb, var(--lv-accent) 25%, transparent);
}

.lv-sub-text {
	margin: 0;
	font-size: 16px;
	line-height: 1.55;
	font-weight: 500;
	word-break: break-word;
}

.lv-sub-tr {
	display: block;
	margin-top: 3px;
	font-size: 13px;
	line-height: 1.5;
	font-weight: 400;
	color: var(--lv-fg-2);
	word-break: break-word;
	animation: lv-fade-in 0.2s ease-out;
}

/* ==========================================================================
   4. Status Chip & LevelMeter (Replacing Crude Red Dot)
   ========================================================================== */
/* TEMP-TRIAL (260925): 用户要求先试隐藏麦克风状态条——录音中/AI 回复中/
   请求权限中一律不显示。组件代码保留，删掉下面这条规则即恢复显示。 */
.lv-micbar {
	display: none !important;
}

.lv-micbar {
	position: absolute;
	bottom: calc(var(--lv-chrome-bottom) + 64px);
	left: 50%;
	transform: translateX(-50%);
	display: inline-flex;
	align-items: center;
	gap: 10px;
	padding: 6px 14px;
	border-radius: 999px;
	background: var(--lv-glass-bg);
	backdrop-filter: var(--lv-glass-blur);
	border: 1px solid var(--lv-glass-border);
	box-shadow: var(--lv-shadow-panel);
	color: var(--lv-fg);
	font-size: 13px;
	font-weight: 500;
	z-index: 8;
	max-width: min(90%, 540px);
	white-space: nowrap;
	animation: lv-slide-up 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.lv-meter {
	display: inline-flex;
	align-items: center;
	gap: 2.5px;
	height: 18px;
}

.lv-meter-bar {
	width: 2.5px;
	border-radius: 999px;
	background: var(--lv-accent);
	transition: height 0.08s ease;
}

.lv-meter-pulsing .lv-meter-bar {
	animation: lv-pulse 1s ease-in-out infinite;
}

.lv-meter-muted .lv-meter-bar {
	opacity: 0.35;
	background: var(--lv-fg-3);
}

/* ==========================================================================
   5. HUD Toolbar & Buttons (Vector Iconography, No Emoji)
   ========================================================================== */
.lv-hud {
	position: absolute;
	bottom: calc(var(--lv-chrome-bottom) + 12px);
	left: 50%;
	transform: translateX(-50%);
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 5px 8px;
	border-radius: 999px;
	background: var(--lv-glass-bg);
	backdrop-filter: var(--lv-glass-blur);
	border: 1px solid var(--lv-glass-border);
	box-shadow: var(--lv-shadow-pop);
	z-index: 9;
	transition: opacity 0.3s ease, transform 0.3s ease;
}

.lv-hud.lv-faded:not(:hover):not(:focus-within) {
	opacity: 0.45;
	transform: translateX(-50%) scale(0.98);
}

.lv-hud.lv-mic-live.lv-faded {
	opacity: 0.85;
}

.lv-btn {
	position: relative;
	width: 36px;
	height: 36px;
	border-radius: 50%;
	border: none;
	background: transparent;
	color: var(--lv-fg-2);
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}

.lv-btn:hover {
	background: var(--lv-hover);
	color: var(--lv-fg);
}

.lv-btn:active {
	transform: scale(0.92);
}

.lv-btn.lv-on {
	color: var(--lv-accent);
	background: color-mix(in srgb, var(--lv-accent) 12%, transparent);
}

/* Mic pulse halo — only plays while the user is actually speaking (level
   above the threshold), so the animation reflects real input instead of
   looping forever even in silence. The base state stays visually quiet. */
.lv-btn.lv-mic-live::after {
	content: "";
	position: absolute;
	inset: -3px;
	border-radius: 50%;
	border: 1.5px solid color-mix(in srgb, var(--lv-accent) 60%, transparent);
	pointer-events: none;
	/* Default: hidden. The keyframes' opacity overrides this while the
	   animation is running on .lv-mic-loud. */
	opacity: 0;
}

.lv-btn.lv-mic-live.lv-mic-loud::after {
	animation: lv-halo 1.4s ease-in-out infinite;
}

.lv-hud-sep {
	width: 1px;
	height: 18px;
	margin: 0 4px;
	background: var(--lv-border-soft);
}

/* Touch targets for phones */
@media (pointer: coarse) {
	.lv-btn {
		width: 42px;
		height: 42px;
	}
}

/* ==========================================================================
   6. Compact Canvas Popover (Quick Switching)
   ========================================================================== */
.lv-pop {
	position: absolute;
	bottom: calc(100% + 12px);
	right: 0;
	width: 290px;
	border-radius: 18px;
	background: var(--lv-glass-bg);
	backdrop-filter: var(--lv-glass-blur);
	border: 1px solid var(--lv-glass-border);
	box-shadow: var(--lv-shadow-pop);
	color: var(--lv-fg);
	font-size: 13px;
	z-index: 9;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	max-height: min(calc(100vh - 280px), 480px);
	transform-origin: bottom right;
	animation: lv-pop-appear 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes lv-pop-appear {
	from {
		opacity: 0;
		transform: scale(0.95) translateY(6px);
	}
	to {
		opacity: 1;
		transform: scale(1) translateY(0);
	}
}

.lv-pop-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px 8px;
	font-size: 13px;
	font-weight: 600;
	color: var(--lv-fg);
	border-bottom: 1px solid var(--lv-border-soft);
}

.lv-pop-close {
	width: 24px;
	height: 24px;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: var(--lv-fg-3);
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
}

.lv-pop-close:hover {
	background: var(--lv-hover);
	color: var(--lv-fg);
}

.lv-pop-body {
	overflow-y: auto;
	padding: 10px 14px 14px;
	scrollbar-width: thin;
}

.lv-pop h4 {
	margin: 10px 2px 6px;
	font-size: 11px;
	font-weight: 600;
	color: var(--lv-fg-3);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.lv-langs {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}

.lv-lang {
	padding: 5px 11px;
	border-radius: 999px;
	border: 1px solid var(--lv-border);
	background: color-mix(in srgb, var(--lv-surface) 40%, transparent);
	color: var(--lv-fg-2);
	font-size: 12px;
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.lv-lang:hover {
	background: var(--lv-hover);
	color: var(--lv-fg);
}

.lv-lang.lv-current {
	border-color: var(--lv-accent);
	background: color-mix(in srgb, var(--lv-accent) 14%, transparent);
	color: var(--lv-accent);
	font-weight: 500;
}

.lv-switch-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 6px 4px;
	font-size: 12.5px;
	color: var(--lv-fg);
}

.lv-switch {
	width: 38px !important;
	height: 22px !important;
	min-width: 38px !important;
	min-height: 22px !important;
	border-radius: 999px !important;
	border: 1px solid var(--lv-border) !important;
	background: var(--lv-surface-2) !important;
	position: relative !important;
	cursor: pointer;
	padding: 0 !important;
	display: inline-block !important;
	flex-shrink: 0 !important;
	box-sizing: border-box !important;
	outline: none;
	transition: background 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.lv-switch.lv-on {
	background: var(--lv-accent) !important;
	border-color: var(--lv-accent) !important;
}

.lv-switch-knob {
	position: absolute !important;
	top: 2px !important;
	left: 2px !important;
	width: 16px !important;
	height: 16px !important;
	border-radius: 50% !important;
	background: #ffffff !important;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
	transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
	display: block !important;
	box-sizing: border-box !important;
}

.lv-switch.lv-on .lv-switch-knob {
	transform: translateX(16px) !important;
}

.lv-calib-trigger-row {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 2px 4px 8px;
}

.lv-btn-calib {
	flex: 1;
	display: inline-flex;
	align-items: center;
	justify-content: space-between;
	padding: 6px 10px;
	border-radius: 8px;
	border: 1px solid var(--lv-border);
	background: color-mix(in srgb, var(--lv-accent) 10%, transparent);
	color: var(--lv-fg);
	font-size: 12px;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.15s ease, border-color 0.15s ease;
}

.lv-btn-calib:hover {
	background: color-mix(in srgb, var(--lv-accent) 18%, transparent);
	border-color: var(--lv-accent);
}

.lv-calib-tag {
	padding: 1px 6px;
	border-radius: 999px;
	background: color-mix(in srgb, #10b981 18%, transparent);
	color: #10b981;
	font-size: 10.5px;
	font-weight: 600;
}

.lv-btn-calib-reset {
	padding: 6px 8px;
	border-radius: 8px;
	border: 1px solid var(--lv-border);
	background: var(--lv-surface-2);
	color: var(--lv-fg-3);
	font-size: 11.5px;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.lv-btn-calib-reset:hover {
	background: var(--lv-hover);
	color: var(--lv-fg);
}

/* ── 视向参数滑块 ─────────────────────────────────────────── */

.lv-look-params {
	margin: 4px 2px 2px;
	padding: 8px 8px 6px;
	border-radius: 10px;
	background: color-mix(in srgb, var(--lv-surface-2) 60%, transparent);
	border: 1px solid var(--lv-border-soft);
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.lv-look-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 4px;
}

.lv-look-title {
	font-size: 11px;
	font-weight: 600;
	color: var(--lv-fg-3);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.lv-look-hint {
	font-size: 11px;
	color: var(--lv-fg-3);
	padding: 2px 0 4px;
}

/* 预设按钮组 */
.lv-look-presets {
	display: flex;
	gap: 6px;
	margin: 4px 0 2px;
}

.lv-look-preset {
	flex: 1;
	padding: 5px 0;
	border-radius: 8px;
	border: 1px solid var(--lv-border);
	background: var(--lv-surface-2);
	color: var(--lv-fg-2);
	font-size: 12px;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.lv-look-preset:hover {
	background: var(--lv-hover);
	color: var(--lv-fg);
}

.lv-look-preset.lv-current {
	background: color-mix(in srgb, var(--lv-accent) 14%, transparent);
	border-color: var(--lv-accent);
	color: var(--lv-accent);
	font-weight: 600;
}

/* 折叠开关 */
.lv-look-fold {
	display: flex;
	align-items: center;
	gap: 5px;
	width: 100%;
	padding: 6px 2px 2px;
	border: none;
	background: transparent;
	color: var(--lv-fg-3);
	font-size: 11.5px;
	cursor: pointer;
	transition: color 0.15s ease;
}

.lv-look-fold:hover {
	color: var(--lv-fg);
}

.lv-look-caret {
	display: inline-block;
	font-size: 10px;
	transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.lv-look-caret.lv-open {
	transform: rotate(90deg);
}

/* 分组滑块 */
.lv-slider-group {
	margin-top: 4px;
}

.lv-slider-group-title {
	font-size: 10.5px;
	font-weight: 600;
	color: var(--lv-fg-3);
	letter-spacing: 0.05em;
	padding: 4px 0 2px;
	border-bottom: 1px dashed var(--lv-border-soft);
	margin-bottom: 2px;
}

.lv-slider-row {
	display: grid;
	grid-template-columns: 88px 1fr 40px;
	align-items: center;
	gap: 8px;
	padding: 3px 0;
	font-size: 12px;
	color: var(--lv-fg);
}

.lv-slider-label {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--lv-fg-2);
}

.lv-slider-row input[type="range"] {
	width: 100%;
	height: 18px;
	margin: 0;
	-webkit-appearance: none;
	appearance: none;
	background: transparent;
	cursor: pointer;
}

.lv-slider-row input[type="range"]::-webkit-slider-runnable-track {
	height: 4px;
	border-radius: 999px;
	background: var(--lv-border);
}

.lv-slider-row input[type="range"]::-webkit-slider-thumb {
	-webkit-appearance: none;
	appearance: none;
	width: 14px;
	height: 14px;
	margin-top: -5px;
	border-radius: 50%;
	background: var(--lv-accent);
	border: 2px solid #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.lv-slider-row input[type="range"]::-moz-range-track {
	height: 4px;
	border-radius: 999px;
	background: var(--lv-border);
}

.lv-slider-row input[type="range"]::-moz-range-thumb {
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: var(--lv-accent);
	border: 2px solid #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.lv-slider-value {
	text-align: right;
	font-variant-numeric: tabular-nums;
	font-size: 11px;
	color: var(--lv-fg-3);
	min-width: 40px;
}

.lv-pop-footer {
	margin-top: 14px;
	padding-top: 10px;
	border-top: 1px solid var(--lv-border-soft);
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.lv-pop-link {
	color: var(--lv-accent);
	text-decoration: none;
	font-size: 12px;
	font-weight: 500;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	cursor: pointer;
	border: none;
	background: transparent;
	padding: 0;
}

.lv-pop-link:hover {
	text-decoration: underline;
}

/* ==========================================================================
   7. Keyboard Input Floating Card
   ========================================================================== */
.lv-input {
	position: absolute;
	/* 260925 用户要求：输入框与 HUD 操作栏之间加一点 margin（HUD 顶约
	   chrome+58px，64px 时几乎贴死 → 76px 留 ~18px 间隙） */
	bottom: calc(var(--lv-chrome-bottom) + 76px);
	left: 50%;
	transform: translateX(-50%);
	width: min(76%, 660px);
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 6px 8px 6px 14px;
	border-radius: 16px;
	background: var(--lv-glass-bg);
	backdrop-filter: var(--lv-glass-blur);
	border: 1px solid var(--lv-glass-border);
	box-shadow: var(--lv-shadow-pop);
	z-index: 9;
}

.lv-input input {
	flex: 1;
	border: none;
	background: transparent;
	color: var(--lv-fg);
	font-size: 14px;
	font-family: inherit;
	outline: none;
}

.lv-input button {
	padding: 7px 14px;
	border-radius: 10px;
	border: none;
	background: var(--lv-accent);
	color: #ffffff;
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.lv-input button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

/* ==========================================================================
   7b. Keyboard (IME) Open State
   --------------------------------------------------------------------------
   When the user opens the text-input panel:
   - Root stays inside its normal container (no automatic fullscreen).
   - The stage height is pinned to its pre-keyboard height (--lv-locked-height)
     so the avatar size, ratio and center position remain completely invariant
     when the soft keyboard pops up. The keyboard merely covers the lower stage.
   - lv-input / lv-micbar / lv-toast are elevated above the on-screen keyboard
     using --lv-ime-height.
   - HUD stays quietly at the bottom.
   ========================================================================== */
.lv-root.lv-keyboard-open {
	--lv-ime-height: 0px;
}

.lv-root.lv-keyboard-open .lv-stage {
	height: var(--lv-locked-height, 100%);
	min-height: 100%;
}

.lv-root.lv-keyboard-open .lv-input {
	bottom: calc(max(var(--lv-chrome-bottom) + 76px, var(--lv-ime-height, 0px) + 16px));
}

.lv-root.lv-keyboard-open .lv-micbar {
	bottom: calc(max(var(--lv-chrome-bottom) + 128px, var(--lv-ime-height, 0px) + 72px));
}

.lv-root.lv-keyboard-open .lv-toast {
	bottom: calc(max(var(--lv-chrome-bottom) + 180px, var(--lv-ime-height, 0px) + 128px));
}

/* ==========================================================================
   8. Toast & Center Status Card
   ========================================================================== */
.lv-toast {
	position: absolute;
	bottom: calc(var(--lv-chrome-bottom) + 120px);
	left: 50%;
	transform: translateX(-50%);
	background: var(--lv-toast-bg);
	color: #ffffff;
	padding: 8px 16px;
	border-radius: 12px;
	font-size: 13px;
	font-weight: 500;
	box-shadow: var(--lv-shadow-pop);
	z-index: 10;
	white-space: nowrap;
	display: flex;
	align-items: center;
	gap: 8px;
	animation: lv-slide-up 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.lv-center {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: none;
}

.lv-card {
	background: var(--lv-surface);
	color: var(--lv-fg);
	padding: 24px 28px;
	border-radius: 18px;
	border: 1px solid var(--lv-border);
	box-shadow: var(--lv-shadow-pop);
	text-align: center;
	max-width: 440px;
	line-height: 1.6;
	font-size: 13px;
	pointer-events: auto;
}

.lv-card b {
	font-size: 16px;
	color: var(--lv-fg);
}

.lv-card.lv-card-error {
	border-color: rgba(239, 68, 68, 0.35);
	background: color-mix(in srgb, var(--lv-surface) 92%, #ef4444 8%);
}

.lv-card-actions {
	display: flex;
	gap: 8px;
	justify-content: center;
	margin-top: 14px;
	flex-wrap: wrap;
}

.lv-card-btn {
	background: var(--lv-surface-2);
	color: var(--lv-fg);
	border: 1px solid var(--lv-border);
	padding: 6px 14px;
	border-radius: 9999px;
	font-size: 12px;
	font-weight: 500;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	transition: all 0.15s ease;
	user-select: none;
}

.lv-card-btn:hover {
	background: var(--lv-hover);
	border-color: var(--lv-accent);
}

.lv-card-btn.lv-card-btn-primary {
	background: var(--lv-accent);
	color: #fff;
	border-color: transparent;
}

.lv-card-btn.lv-card-btn-primary:hover {
	opacity: 0.9;
}

.lv-card-logs {
	margin-top: 12px;
	text-align: left;
	background: rgba(0, 0, 0, 0.45);
	padding: 10px 12px;
	border-radius: 8px;
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	font-size: 11px;
	line-height: 1.45;
	max-height: 140px;
	overflow-y: auto;
	white-space: pre-wrap;
	word-break: break-all;
	color: var(--lv-fg-2);
	border: 1px solid var(--lv-border-soft);
}

/* ==========================================================================
   9. Fullscreen (Immersive Web-App Mode)
   --------------------------------------------------------------------------
   Web-level immersion: fixed 铺满可视区域盖住 DSH 宿主界面，不调起
   浏览器原生全屏。

   三个关键约束（260925 全屏不可用事故的教训）：
   1. 只用 inset: 0 定尺寸 —— fixed + inset:0 铺满的是 *可视区域*，
      移动端自动避开地址栏；绝不用 width/height: 100vw/100vh（那是
      "最大视口"，会把底部 HUD 推到地址栏后面 → 全屏后无法退出）。
   2. z-index 用近最大值 —— 必须压过宿主 DSH 所有 overlay
      （header/侧栏/弹层），否则 HUD 与字幕被宿主 UI 盖住"显示不全"。
   3. 不做任何 canvas CSS 拉伸 —— stage 依旧 absolute inset:0 跟随
      root；Pixi 的 resizeTo(container) 在容器尺寸变化后按容器实际
      clientWidth/clientHeight 调 renderer.resize()，autoDensity 同步
      canvas CSS 尺寸，buffer 与显示永远同源等比。
   ========================================================================== */
.lv-root.lv-fullscreen,
.lv-root:fullscreen {
	position: fixed;
	inset: 0;
	z-index: 2147483000;
	background: var(--lv-base);
	--lv-chrome-bottom: 20px;
}

.lv-root.lv-fullscreen .lv-ambient,
.lv-root:fullscreen .lv-ambient {
	opacity: 1.4;
}

/* Animations */
@keyframes lv-sub-enter {
	from {
		opacity: 0;
		transform: translateY(10px) scale(0.97);
	}
	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

@keyframes lv-slide-up {
	from { opacity: 0; transform: translate(-50%, 8px); }
	to   { opacity: 1; transform: translate(-50%, 0); }
}

@keyframes lv-fade-in {
	from { opacity: 0; }
	to   { opacity: 1; }
}

@keyframes lv-halo {
	0%   { transform: scale(1); opacity: 0.8; }
	50%  { transform: scale(1.3); opacity: 0; }
	100% { transform: scale(1.3); opacity: 0; }
}

@keyframes lv-pulse {
	0%, 100% { opacity: 0.4; }
	50%      { opacity: 1; }
}

@keyframes lv-spin {
	from { transform: rotate(0deg); }
	to   { transform: rotate(360deg); }
}

.lv-spin {
	animation: lv-spin 0.9s linear infinite;
}

/* ==========================================================================
   10. Gaze Smart Calibration Overlay & Reticle
   ========================================================================== */
.lv-calib-overlay {
	position: absolute;
	inset: 0;
	z-index: 25;
	pointer-events: auto;
	background: radial-gradient(circle at 50% 35%, transparent 0%, rgba(10, 14, 26, 0.28) 100%);
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	align-items: center;
	padding: 24px 20px;
	box-sizing: border-box;
	animation: lv-fade-in 0.28s ease;
	user-select: none;
}

.lv-calib-header {
	position: absolute;
	top: 18px;
	left: 50%;
	transform: translateX(-50%);
	width: min(92%, 480px);
	padding: 8px 14px 8px 12px;
	border-radius: 999px;
	background: var(--lv-glass-bg);
	backdrop-filter: var(--lv-glass-blur);
	border: 1px solid var(--lv-glass-border);
	box-shadow: var(--lv-shadow-pop);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	box-sizing: border-box;
}

.lv-calib-header-left {
	display: flex;
	align-items: center;
	gap: 8px;
	overflow: hidden;
}

.lv-calib-pill {
	display: inline-block;
	padding: 3px 9px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--lv-accent) 18%, transparent);
	color: var(--lv-accent);
	font-size: 11.5px;
	font-weight: 600;
	letter-spacing: 0.04em;
	white-space: nowrap;
	flex-shrink: 0;
}

.lv-calib-title {
	margin: 0;
	font-size: 13.5px;
	font-weight: 600;
	color: var(--lv-fg);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.lv-calib-cancel {
	position: static;
	flex-shrink: 0;
	padding: 4px 10px;
	border-radius: 999px;
	border: 1px solid var(--lv-border-soft);
	background: var(--lv-hover);
	color: var(--lv-fg-2);
	font-size: 12px;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.15s ease, color 0.15s ease;
}

.lv-calib-cancel:hover {
	background: var(--lv-active);
	color: var(--lv-fg);
}

/* Calibration Reticle Targeting Character Eyes */
.lv-calib-reticle {
	position: absolute;
	transform: translate(-50%, -50%);
	pointer-events: none;
	transition: left 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	background: radial-gradient(circle, color-mix(in srgb, var(--lv-accent) 18%, transparent) 0%, transparent 70%);
}

.lv-calib-svg {
	display: block;
	transform: rotate(-90deg);
}

.lv-calib-track {
	stroke: color-mix(in srgb, var(--lv-fg) 20%, transparent);
}

body[data-ds-dark-theme] .lv-calib-track,
.lv-root.lv-dark .lv-calib-track {
	stroke: rgba(255, 255, 255, 0.16);
}

.lv-calib-prog {
	stroke: var(--lv-accent);
	stroke-linecap: round;
	transition: stroke-dashoffset 0.1s linear, stroke 0.2s ease;
	filter: drop-shadow(0 0 8px var(--lv-accent));
}

.lv-calib-center-dot {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--lv-accent);
	box-shadow: 0 0 10px var(--lv-accent), 0 0 2px #ffffff;
	transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.lv-face-searching .lv-calib-center-dot {
	background: var(--lv-accent);
	opacity: 0.6;
	animation: lv-pulse 1.2s infinite;
}

.lv-face-searching .lv-calib-prog {
	stroke: color-mix(in srgb, var(--lv-accent) 45%, transparent);
	stroke-dasharray: 4 4;
	filter: drop-shadow(0 0 4px var(--lv-accent));
}

.lv-pulse-success .lv-calib-center-dot {
	transform: translate(-50%, -50%) scale(1.6);
	background: #10b981;
	box-shadow: 0 0 16px #10b981;
}

.lv-pulse-success .lv-calib-prog {
	stroke: #10b981;
	filter: drop-shadow(0 0 10px #10b981);
}

.lv-calib-badge {
	margin-top: 10px;
	padding: 4px 12px;
	border-radius: 999px;
	background: rgba(15, 17, 26, 0.82);
	backdrop-filter: blur(10px);
	border: 1px solid var(--lv-glass-border);
	color: #ffffff;
	font-size: 12px;
	font-weight: 500;
	box-shadow: var(--lv-shadow-panel);
	letter-spacing: 0.02em;
	white-space: nowrap;
}

.lv-calib-footer {
	padding: 8px 16px;
	border-radius: 12px;
	background: color-mix(in srgb, var(--lv-surface) 70%, transparent);
	backdrop-filter: blur(10px);
	border: 1px solid var(--lv-border-soft);
	text-align: center;
	max-width: min(92%, 520px);
}

.lv-calib-hint {
	font-size: 12px;
	color: var(--lv-fg-2);
	line-height: 1.4;
}

/* ── Model selector (compact dropdowns) ───────────────────────────── */
.lv-model-select {
	width: 100%;
	box-sizing: border-box;
	padding: 6px 10px;
	font-size: 12px;
	border-radius: 8px;
	border: 1px solid var(--lv-border);
	background: var(--lv-surface);
	color: var(--lv-fg-2);
	font-family: inherit;
	outline: none;
	cursor: pointer;
	margin-bottom: 6px;
	transition: border-color 0.15s;
}
.lv-model-select:focus {
	border-color: var(--lv-accent);
}
.lv-model-select:disabled {
	opacity: 0.5;
	cursor: default;
}

/* ── Live entry button (session header utilities) ──────────────────── */
.lv-live-entry {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 4px 10px;
	border-radius: 999px;
	border: 1px solid var(--lv-border, rgba(0,0,0,0.10));
	background: transparent;
	color: var(--lv-fg, inherit);
	font-size: 12px;
	font-weight: 600;
	font-family: inherit;
	cursor: pointer;
	transition: background 0.15s, color 0.15s, transform 0.1s;
	white-space: nowrap;
}
.lv-live-entry:hover {
	background: color-mix(in srgb, var(--lv-accent, #4176e6) 8%, transparent);
}
.lv-live-entry:active {
	transform: scale(0.96);
}
/* Active/selected state: shows when the Live2D view is current */
.lv-live-entry[data-pressed] {
	background: color-mix(in srgb, var(--lv-accent-soft, #e4edfd) 50%, transparent);
	color: var(--lv-accent, #4176e6);
}
.lv-live-entry[data-pressed]:active {
	transform: scale(0.96);
}
.lv-live-entry svg {
	flex: none;
}
`;

let injected = false;

export function injectLiveStyles(): void {
	if (injected || typeof document === "undefined") return;
	injected = true;
	const style = document.createElement("style");
	style.id = "dsh-live2d-voice-styles";
	// Claim ownership for the host's HMR bookkeeping: the client module
	// system tags every untagged <style> to whichever plugin materializes
	// next, and a plugin reload deletes all tags it owns. Without this
	// marker, another plugin's reload cycle claims this stylesheet and
	// deletes it on its next rebuild (all lv-* rules vanish until refresh).
	style.setAttribute("data-plugin", "dsh-live2d-voice");
	style.textContent = CSS;
	document.head.appendChild(style);
}
