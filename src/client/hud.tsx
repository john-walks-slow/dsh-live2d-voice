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
import type { GazeCalibration } from "./gaze.js";
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
	IconTouch,
} from "./icons.js";
import { logger } from "./logger.js";
import { useState } from "react";
import {
	Live2DModelSelector,
	VoicePresetSelector,
	LlmModelSelector,
	type LlmModelSelectionValue,
} from "./selectors.js";

export interface HudProps {
	faded: boolean;
	muted: boolean;
	subtitlesOn: boolean;
	inputOpen: boolean;
	popoverOpen: boolean;
	fullscreen: boolean;
	/** Touch mode: the avatar follows the finger (mouse hover counts) and tap/swipe gestures drive the model's own motions. */
	touchMode: boolean;
	onToggleTouchMode: () => void;
	/** True for ~200ms after a swipe was refused because a scripted motion is
	 * playing — the only refusal the user cannot otherwise attribute. */
	touchRefusedFlash?: boolean;
	micState: MicState;
	/** True only when the mic is on AND the live RMS level is above the
	    "user is actually speaking" threshold. Drives the mic button's halo
	    pulse animation — the halo only plays while the user is talking. */
	micLoud: boolean;
	asrConfigured: boolean;
	languages: LanguageOption[];
	currentVoiceId: string;
	currentSttLanguage: string;
	/** Live2D model catalog */
	models: { name: string; label?: string; kind?: "moc2" | "moc3"; group?: string; groupLabel?: string; url: string }[];
	currentModel?: string;
	currentModelGroup: string;
	onPickModelGroup: (id: string) => void;
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
	gazeCalibration?: GazeCalibration;
	onUpdateCalibration?: (patch: Partial<GazeCalibration>) => void;
	onCalibrateCenter?: () => void;
	onResetCalibrationCenter?: () => void;
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
 * gain is a signed amplitude multiplier: a negative gain mirrors that channel
 * (look away from the user, lean the other way, parallax against the input),
 * 0 switches the source off, and small values scale the motion down linearly
 * — so the sliders span negative→positive with the center at 0.
 */
const LOOK_SLIDER_GROUPS: ReadonlyArray<{
	group: string;
	sliders: ReadonlyArray<{ key: keyof LookParams; label: string; min: number; max: number; step: number; tip?: string }>;
}> = [
	{
		group: "灵敏度",
		sliders: [
			{ key: "camSensitivity", label: "摄像头灵敏度", min: 0, max: 2, step: 0.05, tip: "摄像头视线追踪的全局响应灵敏度倍率：0 = 不参与，1 = 标准" },
			{ key: "gyroSensitivity", label: "陀螺仪灵敏度", min: 0, max: 2, step: 0.05, tip: "陀螺仪设备倾斜视差的全局响应灵敏度倍率：0 = 不参与，1 = 标准" },
		],
	},
	{
		group: "动作幅度",
		sliders: [
			{ key: "angleAmp", label: "转头幅度", min: 0, max: 45, step: 1, tip: "视线 / 倾斜满偏时头和身体转动的角度上限（度）" },
			{ key: "eyeAmp", label: "眼球幅度", min: 0, max: 1, step: 0.05, tip: "满偏时眼球 (ParamEyeBallX/Y) 的偏移量：比转头小 = 眼神更含蓄" },
			{ key: "rollAmp", label: "侧倾幅度", min: 0, max: 20, step: 1, tip: "满偏时头部侧倾（ParamAngleZ）的角度上限（度）" },
			{ key: "panAmp", label: "位移幅度", min: 0, max: 0.05, step: 0.001, tip: "满偏时模型整体平移占容器宽 / 高的比例（微视差）" },
			{ key: "bodyZGain", label: "身体侧倾联动", min: 0, max: 1, step: 0.05, tip: "头部侧倾时身体 Z 轴旋转 (ParamBodyAngleZ) 的联动比例" },
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

/**
 * Trim a slider value to the shortest text that still tells tiny values
 * apart: 0.005 must not render as "0.01" (261010 — the 2-decimal rounding hid
 * exactly the subtle settings the sliders exist for).
 */
function trimNumber(value: number): string {
	const abs = Math.abs(value);
	const digits = abs === 0 ? 0 : abs < 0.01 ? 6 : abs < 1 ? 3 : 2;
	return String(Number(value.toFixed(digits)));
}

/** Compact display for slider values (0.20 → 0.2, 22 → 22°, 0.005 → 0.005). */
function formatLookValue(key: keyof LookParams, value: number): string {
	if (key === "angleAmp" || key === "rollAmp") return `${Math.round(value)}°`;
	return trimNumber(value);
}

/** Direct number input allowing keyboard typing (including minus signs and decimals) without getting prematurely wiped. */
function LookParamInput(props: {
	value: number;
	step: number;
	disabled?: boolean;
	title?: string;
	onChange: (val: number) => void;
}) {
	const [text, setText] = useState<string | null>(null);
	const displayed = text !== null ? text : trimNumber(props.value);

	return (
		<input
			type="number"
			className="lv-slider-num-input"
			step={props.step}
			disabled={props.disabled}
			title={props.title}
			value={displayed}
			onFocus={() => setText(String(props.value))}
			onChange={(e) => {
				const next = e.target.value;
				setText(next);
				const parsed = parseFloat(next);
				if (!isNaN(parsed)) props.onChange(parsed);
			}}
			onBlur={() => {
				setText(null);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					(e.target as HTMLInputElement).blur();
				}
			}}
		/>
	);
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
			{/* 底部胶囊：会话相关按钮（视图级按钮搬到右上角 .lv-corner） */}
			<div className="lv-capsule">
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

			{/* 5. 触摸模式：视线跟手指 + 模型手势动作 */}
			<button
				type="button"
				className={`lv-btn${props.touchMode ? " lv-on" : ""}${props.touchRefusedFlash ? " lv-refused" : ""}`}
				title={props.touchMode ? "关闭触摸模式" : "触摸模式：视线跟随手指，可触发模型手势"}
				onClick={props.onToggleTouchMode}
			>
				<IconTouch size={19} />
			</button>

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
								<Live2DModelSelector
									models={props.models}
									value={props.currentModel}
									onChange={props.onPickModel}
									layout="stack"
								/>

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
						<VoicePresetSelector value={props.currentVoiceId} onChange={(preset) => props.onPickVoice(preset)} />

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
						{props.eyeTracking && (
							<div className="lv-gaze-center-box">
								<div className="lv-gaze-center-actions">
									<button
										type="button"
										className="lv-gaze-btn"
										title="以当前面部位置作为正中央 (0, 0)"
										onClick={props.onCalibrateCenter}
									>
										设当前为中心
									</button>
									<button
										type="button"
										className="lv-gaze-btn lv-gaze-btn-subtle"
										title="重置中心偏移为默认值"
										onClick={props.onResetCalibrationCenter}
									>
										重置中心
									</button>
								</div>
								<label className="lv-slider-row" style={{ marginTop: "4px" }}>
									<span className="lv-slider-label">水平中心 X</span>
									<input
										type="range"
										className="lv-signed"
										min={-0.4}
										max={0.4}
										step={0.01}
										value={Math.max(-0.4, Math.min(0.4, props.gazeCalibration?.yawOffset ?? 0))}
										onChange={(e) => props.onUpdateCalibration?.({ yawOffset: Number(e.target.value), matrix: undefined })}
									/>
									<LookParamInput
										step={0.01}
										value={props.gazeCalibration?.yawOffset ?? 0}
										title="手动输入水平中心偏移数值"
										onChange={(val) => props.onUpdateCalibration?.({ yawOffset: val, matrix: undefined })}
									/>
									<span className="lv-slider-value">
										{((props.gazeCalibration?.yawOffset ?? 0) > 0 ? "+" : "") + Math.round((props.gazeCalibration?.yawOffset ?? 0) * 100) / 100}
									</span>
								</label>
								<label className="lv-slider-row">
									<span className="lv-slider-label">垂直中心 Y</span>
									<input
										type="range"
										className="lv-signed"
										min={-0.4}
										max={0.4}
										step={0.01}
										value={Math.max(-0.4, Math.min(0.4, props.gazeCalibration?.pitchOffset ?? -0.08))}
										onChange={(e) => props.onUpdateCalibration?.({ pitchOffset: Number(e.target.value), matrix: undefined })}
									/>
									<LookParamInput
										step={0.01}
										value={props.gazeCalibration?.pitchOffset ?? -0.08}
										title="手动输入垂直中心偏移数值（摄像头在上方时为负值）"
										onChange={(val) => props.onUpdateCalibration?.({ pitchOffset: val, matrix: undefined })}
									/>
									<span className="lv-slider-value">
										{((props.gazeCalibration?.pitchOffset ?? -0.08) > 0 ? "+" : "") + Math.round((props.gazeCalibration?.pitchOffset ?? -0.08) * 100) / 100}
									</span>
								</label>
							</div>
						)}
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
							<div className="lv-look-hint">灵敏度平衡两路输入（摄像头 / 陀螺仪），动作幅度就是满偏时角色的实际动作大小</div>
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
										{group.sliders.map((slider) => (
											<label key={slider.key} className="lv-slider-row">
												<span className="lv-slider-label">
													{slider.label}
												</span>
												<input
													type="range"
													min={slider.min}
													max={slider.max}
													step={slider.step}
													value={Math.max(slider.min, Math.min(slider.max, props.lookParams[slider.key]))}
													title={slider.tip}
													onChange={(event) =>
														props.onLookParamsChange({ [slider.key]: Number(event.target.value) })
													}
												/>
												<LookParamInput
													step={slider.step}
													value={props.lookParams[slider.key]}
													title="手动输入数值（支持超出范围实验）"
													onChange={(val) => props.onLookParamsChange({ [slider.key]: val })}
												/>
												<span className="lv-slider-value">
													{formatLookValue(slider.key, props.lookParams[slider.key])}
												</span>
											</label>
										))}
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

			{/* 右上角视图按钮簇：全屏 / 独立入口（常驻，跟随 HUD 一起淡出） */}
			<div className="lv-corner">
				<button
					type="button"
					className={`lv-btn${props.fullscreen ? " lv-on" : ""}`}
					title={props.fullscreen ? "退出全屏" : "全屏沉浸模式"}
					onClick={props.onToggleFullscreen}
				>
					{props.fullscreen ? <IconMinimize size={19} /> : <IconMaximize size={19} />}
				</button>
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
			</div>
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
	const { catalog, current, onSelect } = props;
	const [pending, setPending] = useState(false);

	const handleChange = async (val: LlmModelSelectionValue | null) => {
		if (!val) return;
		setPending(true);
		try {
			await onSelect(val.provider, val.model, val.reasoningEffort);
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<h4>模型 · 思考程度</h4>
			<LlmModelSelector
				catalog={catalog}
				value={current}
				disabled={pending}
				onChange={(val) => void handleChange(val)}
				layout="stack"
			/>
		</>
	);
}
