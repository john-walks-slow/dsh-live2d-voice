/**
 * The bottom HUD capsule: mic (continuous voice input), TTS mute, subtitles,
 * keyboard input, fullscreen, and the quick-adjust sliders popover.
 *
 * All icons are vector SVGs (no system emojis).
 */

import type { MicState } from "./mic.js";
import type { LanguageOption, VoicePreset } from "./types.js";
import type { ModelCatalog, ModelProviderGroup, ModelSelection } from "./types.js";
import type { LookParams } from "./model.js";
import { LOOK_PRESETS } from "./model.js";
import {
	IconMic,
	IconMicOff,
	IconVolume,
	IconVolumeX,
	IconCaptions,
	IconKeyboard,
	IconMaximize,
	IconMinimize,
	IconSliders,
	IconClose,
	IconExternalLink,
	IconCopy,
} from "./icons.js";
import { logger } from "./logger.js";
import { useState } from "react";

export interface HudProps {
	faded: boolean;
	muted: boolean;
	subtitlesOn: boolean;
	inputOpen: boolean;
	popoverOpen: boolean;
	fullscreen: boolean;
	micState: MicState;
	/** True only when the mic is on AND the live RMS level is above the
	    "user is actually speaking" threshold. Drives the mic button's halo
	    pulse animation — the halo only plays while the user is talking. */
	micLoud: boolean;
	asrConfigured: boolean;
	presets: VoicePreset[];
	languages: LanguageOption[];
	voiceLanguages: LanguageOption[];
	currentVoiceLang: string;
	onPickVoiceLang: (id: string) => void;
	currentVoiceId: string;
	currentSttLanguage: string;
	/** Live2D model catalog */
	models: { name: string; label?: string; kind?: "moc2" | "moc3"; group?: string; groupLabel?: string; url: string }[];
	currentModel?: string;
	currentModelGroup: string;
	onPickModelGroup: (id: string) => void;
	/** Third-person mode: the player's own avatar + voice speaks the user's line first. */
	thirdPerson: boolean;
	/** Polish/translate the user's input into the player persona's line. */
	playerPolish: boolean;
	onToggleThirdPerson: () => void;
	onTogglePlayerPolish: () => void;
	/** The player avatar's current model (undefined = none selected). */
	currentPlayerModel?: string;
	onPickPlayerModel: (name: string) => void;
	/** The player avatar's current voice preset id. */
	currentPlayerVoiceId: string;
	onPickPlayerVoice: (preset: VoicePreset) => void;
	/** Idle motion trigger interval (seconds). */
	idleInterval: number;
	onChangeIdleInterval: (value: number) => void;
	/** Motion definitions available on the current AI model. */
	motions: { name: string; group: string; index: number }[];
	/** Callback invoked when the user clicks a motion debug button. */
	onPlayMotion: (motion: { name: string; group: string; index: number }) => void;
	apiKeyCount: number;
	speechPrompt: string;
	eyeTracking: boolean;
	gyroParallax: boolean;
	/** Current look parameters (pan/angle gains). */
	lookParams: LookParams;
	/** Called when a look parameter changes (live feedback). */
	onLookParamsChange: (params: Partial<LookParams>) => void;
	/** LLM model catalog for the model selector. */
	modelCatalog: ModelCatalog | null;
	/** Current model selection for this session. */
	currentModelSelection: ModelSelection | null;
	/** Called when the user picks a provider/model/effort. */
	onSelectModel: (provider: string, model: string, reasoningEffort?: string) => void;
	onToggleMute: () => void;
	onToggleSubtitles: () => void;
	onToggleInput: () => void;
	onTogglePopover: () => void;
	onToggleFullscreen: () => void;
	/** Open the standalone /app page for this session (GUI only). */
	onOpenStandalone?: () => void;
	onToggleMic: () => void;
	onToggleEyeTracking: () => void;
	onToggleGyroParallax: () => void;
	onStartCalibration?: () => void;
	onResetCalibration?: () => void;
	onPickVoice: (preset: VoicePreset) => void;
	onPickSttLanguage: (id: string) => void;
	onPickModel: (name: string) => void;
	onSavePrompt: (text: string) => void;
	onOpenGlobalSettings?: () => void;
}

/**
 * Look-parameter sliders grouped by source (camera / gyro / range). Every
 * *gain* is signed: a negative gain mirrors that channel (look away from
 * the user, lean the other way, parallax against the input), so the sliders
 * span negative→positive with the center at 0.
 */
const LOOK_SLIDER_GROUPS: ReadonlyArray<{
	group: string;
	sliders: ReadonlyArray<{ key: keyof LookParams; label: string; min: number; max: number; step: number; tip?: string }>;
}> = [
	{
		group: "摄像头",
		sliders: [
			{ key: "camAngleGain", label: "转头增益", min: -2, max: 2, step: 0.05, tip: "视线偏移在转头中的权重（与陀螺仪按权重混合）：0 = 该源不转头，负值 = 反向转头" },
			{ key: "camRollGain", label: "旋转增益", min: -2, max: 2, step: 0.05, tip: "视线水平偏移在头部侧倾（ParamAngleZ）中的权重：0 = 不侧倾，负值 = 侧倾反向" },
			{ key: "camPanGain", label: "位移增益", min: -1, max: 1, step: 0.05, tip: "视线偏移换算成模型整体平移的倍率（直接相乘）：负值 = 视差方向相反" },
		],
	},
	{
		group: "陀螺仪",
		sliders: [
			{ key: "gyroAngleGain", label: "转头增益", min: -2, max: 2, step: 0.05, tip: "陀螺仪偏移在转头中的权重（与摄像头按权重混合）：0 = 该源不转头，负值 = 反向转头" },
			{ key: "gyroRollGain", label: "旋转增益", min: -2, max: 2, step: 0.05, tip: "陀螺仪水平偏移在头部侧倾（ParamAngleZ）中的权重：0 = 不侧倾，负值 = 侧倾反向" },
			{ key: "gyroPanGain", label: "位移增益", min: -1, max: 1, step: 0.05, tip: "陀螺仪偏移换算成模型整体平移的倍率（直接相乘）：负值 = 视差方向相反" },
		],
	},
	{
		group: "整体幅度",
		sliders: [
			{ key: "angleRange", label: "最大转头角度", min: 5, max: 40, step: 1, tip: "转头角度上限（度），与转头增益相乘" },
			{ key: "panRange", label: "最大位移", min: 0.02, max: 0.3, step: 0.01, tip: "平移占容器宽/高的比例上限，与位移增益相乘" },
			{ key: "rollRange", label: "最大侧倾", min: 0, max: 20, step: 1, tip: "侧倾角上限（度），与旋转增益相乘" },
		],
	},
];

/** Which preset (if any) the given params match exactly. */
function matchLookPreset(params: LookParams): string | null {
	for (const preset of LOOK_PRESETS) {
		const keys = Object.keys(preset.params) as Array<keyof LookParams>;
		if (keys.every((key) => preset.params[key] === params[key])) return preset.id;
	}
	return null;
}

/** Signed gain channels — shown with an explicit + so the mirrored half reads as intentional. */
const SIGNED_LOOK_KEYS: ReadonlySet<keyof LookParams> = new Set([
	"camAngleGain",
	"camRollGain",
	"camPanGain",
	"gyroAngleGain",
	"gyroRollGain",
	"gyroPanGain",
]);

/** Compact display for slider values (0.20 → 0.2, 22 → 22°, +0.55). */
function formatLookValue(key: keyof LookParams, value: number): string {
	if (key === "angleRange" || key === "rollRange") return `${value}°`;
	const rounded = Math.round(value * 100) / 100;
	if (SIGNED_LOOK_KEYS.has(key)) return rounded > 0 ? `+${rounded}` : String(rounded);
	return String(rounded);
}

export function Hud(props: HudProps) {
	const micOn = props.micState === "listening" || props.micState === "requesting";
	const [logCopied, setLogCopied] = useState(false);
	/** Detailed look sliders fold (collapsed by default; presets cover 99%). */
	const [lookAdvanced, setLookAdvanced] = useState(false);
	/** Motion debug fold (collapsed by default; model-specific list). */
	const [motionDebugOpen, setMotionDebugOpen] = useState(false);

	const handleCopyLogs = async () => {
		try {
			const text = logger.exportLogsText();
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				const textarea = document.createElement("textarea");
				textarea.value = text;
				document.body.appendChild(textarea);
				textarea.select();
				document.execCommand("copy");
				document.body.removeChild(textarea);
			}
			setLogCopied(true);
			window.setTimeout(() => setLogCopied(false), 2500);
		} catch (err) {
			logger.warn("Failed to copy logs in HUD", err);
		}
	};

	return (
		<div className={`lv-hud${props.faded ? " lv-faded" : ""}${micOn ? " lv-mic-live" : ""}`}>
			{/* 1. 麦克风录音控制 */}
			<button
				type="button"
				className={`lv-btn lv-mic${micOn ? " lv-on lv-mic-live" : ""}${micOn && props.micLoud ? " lv-mic-loud" : ""}`}
				title={
					!props.asrConfigured
						? "语音输入未配置（可在设置中配置火山 ASR 凭证）"
						: micOn
							? "关闭语音输入"
							: "开启语音对话：连续倾听"
				}
				onClick={props.onToggleMic}
			>
				{micOn ? <IconMic size={19} /> : <IconMicOff size={19} />}
			</button>

			{/* 2. 朗读声音静音 */}
			<button
				type="button"
				className={`lv-btn${props.muted ? "" : " lv-on"}`}
				title={props.muted ? "取消静音（开启角色朗读）" : "静音角色语音"}
				onClick={props.onToggleMute}
			>
				{props.muted ? <IconVolumeX size={19} /> : <IconVolume size={19} />}
			</button>

			{/* 3. 双语字幕开关 */}
			<button
				type="button"
				className={`lv-btn${props.subtitlesOn ? " lv-on" : ""}`}
				title={props.subtitlesOn ? "隐藏字幕" : "显示字幕"}
				onClick={props.onToggleSubtitles}
			>
				<IconCaptions size={19} />
			</button>

			{/* 4. 键盘文本输入 */}
			<button
				type="button"
				className={`lv-btn${props.inputOpen ? " lv-on" : ""}`}
				title={props.inputOpen ? "收起键盘输入" : "打字输入"}
				onClick={props.onToggleInput}
			>
				<IconKeyboard size={19} />
			</button>

			{/* 5. 沉浸全屏模式 */}
			<button
				type="button"
				className={`lv-btn${props.fullscreen ? " lv-on" : ""}`}
				title={props.fullscreen ? "退出全屏" : "全屏沉浸模式"}
				onClick={props.onToggleFullscreen}
			>
				{props.fullscreen ? <IconMinimize size={19} /> : <IconMaximize size={19} />}
			</button>

			{/* 5b. 独立入口（仅 GUI：新开 /live2d-voice/app 单会话页） */}
			{props.onOpenStandalone && (
				<button
					type="button"
					className="lv-btn"
					title="独立入口（新窗口打开单会话角色页）"
					onClick={props.onOpenStandalone}
				>
					<IconExternalLink size={18} />
				</button>
			)}

			<div className="lv-hud-sep" />

			{/* 6. 快捷面板（音色与模型快切） */}
			<button
				type="button"
				className={`lv-btn${props.popoverOpen ? " lv-on" : ""}`}
				title="快捷调整（音色与角色）"
				onClick={() => {
					props.onTogglePopover();
				}}
			>
				<IconSliders size={18} />
			</button>

			{/* 快捷弹出面板 */}
			{props.popoverOpen && (
				<div className="lv-pop">
					<div className="lv-pop-head">
						<span>快捷调整</span>
						<button
							type="button"
							className="lv-pop-close"
							title="关闭"
							onClick={() => {
								props.onTogglePopover();
							}}
						>
							<IconClose size={15} />
						</button>
					</div>

					<div className="lv-pop-body">
						{/* 角色模型：二级下拉（分类 → 模型） */}
						{props.models.length > 1 && (
							<>
								<h4>角色模型</h4>
								{(() => {
									const groups: { label: string; id: string; items: (typeof props.models)[number][] }[] = [];
									for (const model of props.models) {
										const id = model.group ?? "";
										const label = model.groupLabel ?? model.group ?? "";
										let g = groups.find((x) => x.id === id);
										if (!g) {
											g = { id, label, items: [] };
											groups.push(g);
										}
										g.items.push(model);
									}
									const currentGroupId = (() => {
										const hit = props.models.find((m) => m.name === props.currentModel);
										return hit?.group ?? "";
									})();
									const filteredModels = props.models.filter((m) => (m.group ?? "") === currentGroupId);
									return (
										<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
											<select
												className="lv-model-select"
												value={currentGroupId}
												onChange={(e) => props.onPickModelGroup(e.target.value)}
											>
												{groups.map((g) => (
													<option key={g.id || "uncategorized"} value={g.id}>
														{g.label || "未分类"} ({g.items.length})
													</option>
												))}
											</select>
											<select
												className="lv-model-select"
												value={props.currentModel ?? ""}
												onChange={(e) => props.onPickModel(e.target.value)}
											>
												{filteredModels.map((model) => (
													<option key={model.name} value={model.name}>
														{model.label ?? model.name}{model.kind === "moc2" ? "（旧版）" : ""}
													</option>
												))}
											</select>
										</div>
									);
								})()}

								{/* 动作调试：默认收起，展开后展示当前模型全部动作按钮。 */}
								<div className="lv-look-params">
									<button
										type="button"
										className="lv-look-fold"
										aria-expanded={motionDebugOpen}
										onClick={() => setMotionDebugOpen((open) => !open)}
									>
										<span className={`lv-look-caret${motionDebugOpen ? " lv-open" : ""}`}>▸</span>
										动作调试 ({props.motions.length})
									</button>
									{motionDebugOpen && (
										<div className="lv-langs" style={{ marginTop: "6px" }}>
											{props.motions.length === 0 ? (
												<div className="lv-look-hint">当前模型未提供动作文件</div>
											) : (
												props.motions.map((m) => (
													<button
														key={`${m.group}_${m.index}_${m.name}`}
														type="button"
														className="lv-lang"
														title={`group=${m.group || "(default)"} index=${m.index}`}
														onClick={() => props.onPlayMotion(m)}
													>
														{m.name}
													</button>
												))
											)}
										</div>
									)}
								</div>

								{/* Idle 间隔调节 */}
								<div className="lv-look-params">
									<div className="lv-look-header">
										<span className="lv-look-title">待机动作间隔</span>
										<span className="lv-look-hint">
											{props.idleInterval <= 0 ? "关闭（仅呼吸+眨眼）" : `${props.idleInterval}s`}
										</span>
									</div>
									<input
										type="range"
										min={0}
										max={120}
										step={5}
										value={props.idleInterval}
										onChange={(e) => props.onChangeIdleInterval(Number(e.target.value))}
									/>
								</div>
							</>
						)}

						{/* 第三人称模式：玩家的台词先由玩家的化身说出 */}
						<h4>第三人称</h4>
						<div className="lv-switch-row">
							<span>第三人称模式</span>
							<button
								type="button"
								role="switch"
								aria-checked={props.thirdPerson}
								className={`lv-switch${props.thirdPerson ? " lv-on" : ""}`}
								onClick={props.onToggleThirdPerson}
							>
								<span className="lv-switch-knob" />
							</button>
						</div>
						{props.thirdPerson && (
							<>
								{props.models.length > 1 && (
									<>
										<div className="lv-look-hint">玩家角色</div>
										<select
											className="lv-model-select"
											value={props.currentPlayerModel ?? ""}
											onChange={(e) => props.onPickPlayerModel(e.target.value)}
										>
											{props.models.map((model) => (
												<option key={model.name} value={model.name}>
													{model.label ?? model.name}{model.kind === "moc2" ? "（旧版）" : ""}
												</option>
											))}
										</select>
									</>
								)}
								<div className="lv-look-hint">玩家音色</div>
								<select
									className="lv-model-select"
									value={props.currentPlayerVoiceId}
									onChange={(e) => {
										const hit = props.presets.find((p) => p.voiceId === e.target.value);
										if (hit) props.onPickPlayerVoice(hit);
									}}
								>
									{props.presets.map((preset) => (
										<option key={preset.id} value={preset.voiceId}>
											{preset.label}
										</option>
									))}
								</select>
								{props.currentPlayerVoiceId === props.currentVoiceId && (
									<div className="lv-look-hint">玩家音色与 AI 相同，建议换一个更好分辨</div>
								)}
								<div className="lv-switch-row">
									<span>台词润色 / 翻译</span>
									<button
										type="button"
										role="switch"
										aria-checked={props.playerPolish}
										className={`lv-switch${props.playerPolish ? " lv-on" : ""}`}
										onClick={props.onTogglePlayerPolish}
									>
										<span className="lv-switch-knob" />
									</button>
								</div>
							</>
						)}

						{/* LLM 模型与思考程度选择 */}
						{props.modelCatalog && props.modelCatalog.groups.length > 0 && (
							<ModelSelector
								catalog={props.modelCatalog}
								current={props.currentModelSelection}
								onSelect={props.onSelectModel}
							/>
						)}

						{/* 音色快切：二级下拉（语言 → 音色） */}
						<h4>角色音色</h4>
						{(() => {
							const filteredPresets = props.presets.filter((preset) => {
								if (props.currentVoiceLang === "all") return true;
								const lang = (preset as VoicePreset & { lang?: string }).lang;
								if (!lang) return props.currentVoiceLang === "zh";
								return lang === props.currentVoiceLang;
							});
							return (
								<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
									<select
										className="lv-model-select"
										value={props.currentVoiceLang}
										onChange={(e) => props.onPickVoiceLang(e.target.value)}
									>
										{props.voiceLanguages.map((lang) => (
											<option key={lang.id} value={lang.id}>
												{lang.label}
											</option>
										))}
									</select>
									<select
										className="lv-model-select"
										value={props.currentVoiceId}
										onChange={(e) => {
											const hit = props.presets.find((p) => p.voiceId === e.target.value);
											if (hit) props.onPickVoice(hit);
										}}
									>
										{filteredPresets.map((preset) => (
											<option key={preset.id} value={preset.voiceId}>
												{preset.label}
											</option>
										))}
									</select>
								</div>
							);
						})()}

						{/* 识别语言快切 */}
						<h4>识别语言</h4>
						<div className="lv-langs">
							{props.languages.map((language) => (
								<button
									key={language.id}
									type="button"
									className={`lv-lang${language.id === props.currentSttLanguage ? " lv-current" : ""}`}
									onClick={() => props.onPickSttLanguage(language.id)}
								>
									{language.label}
								</button>
							))}
						</div>

						{/* 实验性实时开关 */}
						<h4>体感实验</h4>
						<div className="lv-switch-row">
							<span>视线追踪 (前置摄像头)</span>
							<button
								type="button"
								role="switch"
								aria-checked={props.eyeTracking}
								className={`lv-switch${props.eyeTracking ? " lv-on" : ""}`}
								onClick={props.onToggleEyeTracking}
							>
								<span className="lv-switch-knob" />
							</button>
						</div>
						<div className="lv-switch-row">
							<span>陀螺仪 3D 视差</span>
							<button
								type="button"
								role="switch"
								aria-checked={props.gyroParallax}
								className={`lv-switch${props.gyroParallax ? " lv-on" : ""}`}
								onClick={props.onToggleGyroParallax}
							>
								<span className="lv-switch-knob" />
							</button>
						</div>

						{/* 视向灵敏度：预设 + 折叠详细参数 */}
						<div className="lv-look-params">
							<div className="lv-look-header">
								<span className="lv-look-title">视向灵敏度</span>
							</div>
							{!props.eyeTracking && !props.gyroParallax && (
								<div className="lv-look-hint">开启视线追踪或陀螺仪视差后生效</div>
							)}
							<div className="lv-look-hint">转头 / 旋转 / 位移增益均可为负：负值 = 与输入方向相反，0 = 该源不参与</div>
							<div className="lv-look-presets">
								{LOOK_PRESETS.map((preset) => (
									<button
										key={preset.id}
										type="button"
										className={`lv-look-preset${matchLookPreset(props.lookParams) === preset.id ? " lv-current" : ""}`}
										onClick={() => props.onLookParamsChange({ ...preset.params })}
									>
										{preset.label}
									</button>
								))}
							</div>
							<button
								type="button"
								className="lv-look-fold"
								aria-expanded={lookAdvanced}
								onClick={() => setLookAdvanced((open) => !open)}
							>
								<span className={`lv-look-caret${lookAdvanced ? " lv-open" : ""}`}>▸</span>
								详细参数
							</button>
							{lookAdvanced &&
								LOOK_SLIDER_GROUPS.map((group) => (
									<div key={group.group} className="lv-slider-group">
										<div className="lv-slider-group-title">{group.group}</div>
																				{group.sliders.map((slider) => {
											// Third-person stage: characters face each other and camera/gyro only
											// drive position parallax, so the angle + roll gains are forced to 0 —
											// disable the sliders instead of showing values that silently do nothing.
											const stageAngleOff =
												props.thirdPerson &&
												Boolean(props.currentPlayerModel) &&
												(slider.key === "camAngleGain" || slider.key === "gyroAngleGain" || slider.key === "camRollGain" || slider.key === "gyroRollGain");
											const signed = SIGNED_LOOK_KEYS.has(slider.key);
											return (
												<label key={slider.key} className="lv-slider-row">
													<span className="lv-slider-label">
														{slider.label}
														{stageAngleOff ? "（对视停用）" : ""}
													</span>
													<input
														type="range"
														className={signed ? "lv-signed" : undefined}
														min={slider.min}
														max={slider.max}
														step={slider.step}
														value={props.lookParams[slider.key]}
														disabled={stageAngleOff}
														title={stageAngleOff ? "第三人称对视模式下转头/旋转增益固定为 0（视线输入只做位置视差）" : slider.tip}
														onChange={(event) =>
															props.onLookParamsChange({ [slider.key]: Number(event.target.value) })
														}
													/>
													<span className="lv-slider-value">
														{formatLookValue(slider.key, props.lookParams[slider.key])}
													</span>
												</label>
											);
										})}
									</div>
								))}
						</div>

						{/* 底部跳转完整系统设置 与 复制排查日志 */}
						<div className="lv-pop-footer">
							<button
								type="button"
								className="lv-pop-link"
								onClick={() => {
									props.onTogglePopover();
									if (props.onOpenGlobalSettings) {
										props.onOpenGlobalSettings();
									}
								}}
							>
								<span>系统设置</span>
								<IconExternalLink size={13} />
							</button>

							<button
								type="button"
								className="lv-pop-link"
								style={{ color: logCopied ? "#34d399" : "var(--lv-fg-2)" }}
								onClick={() => void handleCopyLogs()}
							>
								<IconCopy size={12} />
								<span>{logCopied ? "已复制日志 ✓" : "复制排障日志"}</span>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ──────────────────────────────────────────────────────────────────────
// ModelSelector: compact two-dropdown LLM model + effort picker.
// ──────────────────────────────────────────────────────────────────────

interface ModelSelectorProps {
	catalog: ModelCatalog;
	current: ModelSelection | null;
	onSelect: (provider: string, model: string, reasoningEffort?: string) => void;
}

function ModelSelector(props: ModelSelectorProps) {
	const { catalog, current } = props;
	const [pending, setPending] = useState(false);

	const currentProvider = current?.provider ?? catalog.default.provider;
	const currentModel = current?.model ?? catalog.default.model;
	const currentEffort = current?.reasoningEffort;

	// Find the selected model to check if it supports reasoning efforts.
	const selectedGroup = catalog.groups.find((g) => g.id === currentProvider);
	const selectedModel = selectedGroup?.models.find((m) => m.id === currentModel);
	const efforts = selectedModel?.reasoning?.efforts ?? [];
	const effectiveEffort = currentEffort ?? selectedModel?.reasoning?.defaultEffort;

	const handleChange = async (value: string, effort?: string) => {
		const sep = value.indexOf(":");
		if (sep < 0) return;
		const provider = value.slice(0, sep);
		const model = value.slice(sep + 1);
		setPending(true);
		try {
			await props.onSelect(provider, model, effort);
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<h4>模型 · 思考程度</h4>
			<select
				className="lv-model-select"
				disabled={pending}
				value={`${currentProvider}:${currentModel}`}
				onChange={(e) => void handleChange(e.target.value)}
			>
				{catalog.groups.map((g) => (
					<optgroup key={g.id} label={g.name}>
						{g.models.map((m) => (
							<option key={m.id} value={`${g.id}:${m.id}`}>
								{m.name}
							</option>
						))}
					</optgroup>
				))}
			</select>
			{efforts.length > 0 && (
				<select
					className="lv-model-select"
					disabled={pending}
					value={effectiveEffort ?? ""}
					onChange={(e) => void handleChange(`${currentProvider}:${currentModel}`, e.target.value || undefined)}
				>
					<option value="">默认</option>
					{efforts.map((eff) => (
						<option key={eff.id} value={eff.id}>
							{eff.name}
						</option>
					))}
				</select>
			)}
		</>
	);
}
