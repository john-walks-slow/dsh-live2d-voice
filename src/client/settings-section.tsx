import { useState, useEffect, useCallback } from "react";
import type { PublicConfig, VoicePreset, LanguageOption, ModelCatalog, ModelProviderGroup, ModelCatalogModel } from "./types.js";
import { fetchConfig, saveConfig, fetchModelCatalog } from "./api.js";
import {
	IconRefresh,
	IconCheck,
	IconAlert,
} from "./icons.js";
import {
	Live2DModelSelector,
	VoicePresetSelector,
	DedicatedModelCard,
} from "./selectors.js";

const CSS_SETTINGS = `
.lv-set-wrap {
	max-width: 680px;
	margin: 0 auto;
	padding: 8px 0 32px;
	color: var(--dsw-alias-label-primary, #0f1115);
	font-family: var(--dsw-font-family, system-ui, sans-serif);
	line-height: 1.5;
}

body[data-ds-dark-theme] .lv-set-wrap {
	color: var(--dsw-alias-label-primary, #f9fafb);
}

.lv-set-header {
	margin-bottom: 20px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
}

.lv-set-title {
	margin: 0 0 4px;
	font-size: 18px;
	font-weight: 650;
	letter-spacing: -0.01em;
}

.lv-set-desc {
	margin: 0;
	font-size: 13px;
	color: var(--dsw-alias-label-secondary, #61666b);
}

.lv-set-card {
	background: var(--dsw-alias-bg-layer-2, #ffffff);
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
	border-radius: 14px;
	padding: 16px 20px;
	margin-bottom: 16px;
	box-shadow: 0 1px 3px rgba(0,0,0,0.02);
}

body[data-ds-dark-theme] .lv-set-card {
	background: var(--dsw-alias-bg-layer-2, #1c1d21);
	border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.08));
}

.lv-set-card-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 14px;
}

.lv-set-card-title {
	margin: 0;
	font-size: 14.5px;
	font-weight: 600;
	display: flex;
	align-items: center;
	gap: 6px;
}

.lv-set-field {
	margin-bottom: 14px;
}

.lv-set-field:last-child {
	margin-bottom: 0;
}

.lv-set-label {
	display: block;
	font-size: 12.5px;
	font-weight: 550;
	margin-bottom: 6px;
	color: var(--dsw-alias-label-primary, #0f1115);
}

body[data-ds-dark-theme] .lv-set-label {
	color: var(--dsw-alias-label-primary, #f9fafb);
}

.lv-set-help {
	font-size: 12px;
	color: var(--dsw-alias-label-tertiary, #81858c);
	margin-top: 4px;
}

.lv-set-input, .lv-set-select, .lv-set-textarea, .lv-set-wrap .lv-model-select {
	width: 100%;
	box-sizing: border-box;
	padding: 8px 12px;
	font-size: 13px;
	border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
	background: var(--dsw-alias-bg-layer-1, #ffffff);
	color: inherit;
	font-family: inherit;
	outline: none;
	cursor: pointer;
	margin-bottom: 0;
	transition: border-color 0.15s ease;
}

body[data-ds-dark-theme] .lv-set-input,
body[data-ds-dark-theme] .lv-set-select,
body[data-ds-dark-theme] .lv-set-textarea,
body[data-ds-dark-theme] .lv-set-wrap .lv-model-select {
	background: var(--dsw-alias-bg-layer-1, #151517);
	border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
	color: var(--dsw-alias-label-primary, #f9fafb);
}

.lv-set-input:focus, .lv-set-select:focus, .lv-set-textarea:focus, .lv-set-wrap .lv-model-select:focus {
	border-color: var(--dsw-alias-state-business-primary, #4176e6);
}

.lv-set-wrap .lv-model-select optgroup {
	font-weight: 600;
	color: var(--dsw-alias-label-secondary, #61666b);
	background: var(--dsw-alias-bg-layer-1, #ffffff);
}
body[data-ds-dark-theme] .lv-set-wrap .lv-model-select optgroup {
	color: var(--dsw-alias-label-secondary, #9ca3af);
	background: var(--dsw-alias-bg-layer-1, #151517);
}

.lv-set-wrap .lv-select-group {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
}
.lv-set-wrap .lv-select-group-row {
	display: flex;
	flex-direction: row;
	gap: 8px;
	width: 100%;
}
.lv-set-wrap .lv-select-group-row > .lv-model-select {
	flex: 1;
	min-width: 0;
}
@media (max-width: 480px) {
	.lv-set-wrap .lv-select-group-row {
		flex-direction: column;
		gap: 6px;
	}
}

.lv-set-row {
	display: flex;
	gap: 8px;
	align-items: center;
}

.lv-set-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 7px 14px;
	border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
	background: var(--dsw-alias-bg-layer-2, #ffffff);
	color: inherit;
	font-size: 12.5px;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
}

.lv-set-btn:hover {
	background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05));
}

.lv-set-btn-primary {
	background: var(--dsw-alias-state-business-primary, #4176e6);
	color: #ffffff;
	border-color: transparent;
}

.lv-set-btn-primary:hover {
	opacity: 0.92;
	background: var(--dsw-alias-state-business-primary, #4176e6);
}

.lv-set-banner {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border-radius: 10px;
	font-size: 13px;
	margin-bottom: 16px;
	border: 1px solid transparent;
}

.lv-set-banner-success {
	background: rgba(34, 197, 94, 0.1);
	border-color: rgba(34, 197, 94, 0.25);
	color: #16a34a;
}

.lv-set-banner-warn {
	background: rgba(245, 158, 11, 0.1);
	border-color: rgba(245, 158, 11, 0.25);
	color: #d97706;
}

.lv-set-status-dot {
	display: inline-block;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: #16a34a;
	margin-right: 6px;
}

.lv-set-links {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 2px;
}

.lv-set-link {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 13px;
	color: var(--dsw-alias-state-business-primary, #4176e6);
	text-decoration: none;
	word-break: break-all;
}

.lv-set-link:hover {
	text-decoration: underline;
}
`;

export function Live2DSettingsSection() {
	const [config, setConfig] = useState<PublicConfig | null>(null);
	const [presets, setPresets] = useState<VoicePreset[]>([]);
	const [voiceLanguages, setVoiceLanguages] = useState<LanguageOption[]>([]);
	const [models, setModels] = useState<{ name: string; label?: string; kind?: "moc2" | "moc3"; group?: string; groupLabel?: string; url: string }[]>([]);
	const [loading, setLoading] = useState(true);
	const [statusMsg, setStatusMsg] = useState<{ type: "success" | "warn"; text: string } | null>(null);

	// Editable drafts
	const [modelPath, setModelPath] = useState("");
	const [voiceId, setVoiceId] = useState("");
	const [ttsModel, setTtsModel] = useState("s2.1-pro-free");
	const [apiKeyFile, setApiKeyFile] = useState("");
	const [asrFile, setAsrFile] = useState("");
	const [speechLang, setSpeechLang] = useState("ja");
	const [subLang, setSubLang] = useState("zh");
	const [sentenceSubs, setSentenceSubs] = useState(true);
	const [idleSec, setIdleSec] = useState(20);
	const [gazeMode, setGazeMode] = useState<"follow" | "natural">("natural");
	const [idleGaze, setIdleGaze] = useState(true);
	const [sttLang, setSttLang] = useState("auto");
	const [asrMode, setAsrMode] = useState("stream");
	const [micNs, setMicNs] = useState(true);
	const [prompt, setPrompt] = useState("");
	const [saving, setSaving] = useState(false);
	// Third-person mode drafts
	const [thirdPerson, setThirdPerson] = useState(false);
	const [playerModelSel, setPlayerModelSel] = useState("");
	const [playerVoiceId, setPlayerVoiceId] = useState("");
	const [playerPolish, setPlayerPolish] = useState(true);
	const [playerLang, setPlayerLang] = useState("zh");
	const [playerPrompt, setPlayerPrompt] = useState("");
	// Live model auto-switch config
	const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);

	const loadAll = useCallback(() => {
		setLoading(true);
		fetchConfig()
			.then((data: { config: PublicConfig; presets: VoicePreset[]; languages: LanguageOption[]; voiceLanguages?: LanguageOption[] }) => {
				setConfig(data.config);
				setPresets(data.presets || []);
				if (data.voiceLanguages) setVoiceLanguages(data.voiceLanguages);
				setModelPath(data.config.modelPath || "");
				setVoiceId(data.config.voiceId || "");
				setTtsModel(data.config.ttsModel || "s2.1-pro-free");
				setApiKeyFile(data.config.apiKeyFile || "");
				setAsrFile(data.config.asrCredentialsFile || "");
				setSpeechLang(data.config.speechLanguage || "ja");
				setSubLang(data.config.subtitleLanguage || "zh");
				setSentenceSubs(data.config.sentenceSubtitles ?? true);
				setIdleSec(typeof data.config.idleInterval === "number" ? data.config.idleInterval : 20);
				setGazeMode(data.config.gazeMode === "follow" ? "follow" : "natural");
				setIdleGaze(data.config.idleGaze !== false);
				setSttLang(data.config.sttLanguage || "auto");
				setAsrMode(data.config.asrMode || "stream");
				setMicNs(data.config.micNoiseSuppression !== false);
				setPrompt(data.config.speechPrompt || "");
				setThirdPerson(data.config.thirdPerson === true);
				setPlayerModelSel(data.config.playerModelSelection || "");
				setPlayerVoiceId(data.config.playerVoiceId || "");
				setPlayerPolish(data.config.playerPolish !== false);
				setPlayerLang(data.config.playerSpeechLanguage || "zh");
				setPlayerPrompt(data.config.playerPrompt || "");
				setLoading(false);
			})
			.catch((err: unknown) => {
				setStatusMsg({ type: "warn", text: `加载配置失败: ${String(err)}` });
				setLoading(false);
			});

		fetch("/live2d-voice/model", { headers: { accept: "application/json" } })
			.then((r) => r.json())
			.then((d: { models?: { name: string; url: string }[] }) => setModels(d.models || []))
			.catch(() => undefined);

		// Fetch LLM model catalog for the live-model picker
		fetchModelCatalog()
			.then((catalog) => setModelCatalog(catalog))
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	const handleSave = async (patch: Partial<PublicConfig>) => {
		setSaving(true);
		try {
			const res = await saveConfig(patch);
			setConfig(res.config);
			setStatusMsg({ type: "success", text: "设置已保存并全局生效，无需重启。" });
		} catch (err) {
			setStatusMsg({ type: "warn", text: `保存失败: ${String(err)}` });
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="lv-set-wrap" style={{ padding: "40px 0", textAlign: "center" }}>
				<style>{CSS_SETTINGS}</style>
				正在加载 Live2D 全局配置…
			</div>
		);
	}

	const hasVoice = (config?.apiKeyCount ?? 0) > 0;
	const hasAsr = config?.asrConfigured ?? false;

	return (
		<div className="lv-set-wrap">
			<style>{CSS_SETTINGS}</style>

			<div className="lv-set-header">
				<h2 className="lv-set-title">Live2D 角色与语音全局配置</h2>
				<p className="lv-set-desc">
					管理系统全局默认角色模型、TTS 合成密钥与 ASR 语音识别凭据。保存后即刻生效。
				</p>
			</div>

			{/* 状态横幅 */}
			{statusMsg && (
				<div className={`lv-set-banner lv-set-banner-${statusMsg.type}`}>
					{statusMsg.type === "success" ? <IconCheck size={16} /> : <IconAlert size={16} />}
					<span>{statusMsg.text}</span>
				</div>
			)}

			{!statusMsg && (
				<div className={`lv-set-banner ${hasVoice && hasAsr ? "lv-set-banner-success" : "lv-set-banner-warn"}`}>
					<span className="lv-set-status-dot" style={{ background: hasVoice && hasAsr ? "#16a34a" : "#d97706" }} />
					<span>
						{hasVoice && hasAsr
							? `语音对话全链路就绪 · Fish Audio Key (${config?.apiKeyCount}个) · 火山 ASR 已配置`
							: `语音服务未就绪：${!hasVoice ? "未配置 Fish Audio Key（TTS 无声）；" : ""}${!hasAsr ? "未配置火山 ASR 凭证（无法麦克风输入）" : ""}`}
					</span>
				</div>
			)}

			{/* 模块 1：角色模型库 */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">① 角色模型管理</h3>
					<button type="button" className="lv-set-btn" onClick={loadAll} title="刷新目录扫描">
						<IconRefresh size={14} /> 刷新扫描
					</button>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">模型目录 (modelPath)</label>
					<div className="lv-set-row">
						<input
							type="text"
							className="lv-set-input"
							value={modelPath}
							placeholder="例如：/root/.dsh/live2d-voice-models"
							onChange={(e) => setModelPath(e.target.value)}
						/>
						<button
							type="button"
							className="lv-set-btn lv-set-btn-primary"
							disabled={saving}
							onClick={() => handleSave({ modelPath })}
						>
							保存
						</button>
					</div>
					<div className="lv-set-help">
						指向单个包含 <code>.model3.json</code> 的文件夹，或包含多个角色子文件夹的上级目录。
					</div>
				</div>
				{models.length > 0 && (
					<div className="lv-set-field" style={{ marginTop: "12px" }}>
						<label className="lv-set-label">选择角色模型 ({models.length} 个可用)</label>
						<Live2DModelSelector
							models={models}
							value={config?.modelSelection}
							onChange={(modelName) => handleSave({ modelSelection: modelName })}
							autoSelectFirstOnGroupChange={false}
							layout="row"
						/>
						{config?.modelSelection && (
							<div className="lv-set-help" style={{ marginTop: "6px" }}>
								当前默认模型：<code>{config.modelSelection}</code>
								{(() => {
									const cur = models.find((m) => m.name === config.modelSelection);
									return cur ? ` (${cur.label ?? cur.name}${cur.kind === "moc2" ? " · 旧版moc2" : ""})` : "";
								})()}
							</div>
						)}
					</div>
				)}
			</div>

			{/* 模块 2：语音合成 TTS */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">② 语音合成 (TTS - Fish Audio)</h3>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">API Key 凭据文件 (apiKeyFile)</label>
					<div className="lv-set-row">
						<input
							type="text"
							className="lv-set-input"
							value={apiKeyFile}
							placeholder="例如：/root/.config/fish-audio/keys.json"
							onChange={(e) => setApiKeyFile(e.target.value)}
						/>
						<button
							type="button"
							className="lv-set-btn lv-set-btn-primary"
							disabled={saving}
							onClick={() => handleSave({ apiKeyFile })}
						>
							保存
						</button>
					</div>
					<div className="lv-set-help">
						支持每行一个 Key 或 JSON 数组。401/402/429 时将自动轮询下一个可用 Key。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">TTS 合成模型</label>
					<select
						className="lv-set-select"
						value={ttsModel}
						onChange={(e) => {
							setTtsModel(e.target.value);
							handleSave({ ttsModel: e.target.value });
						}}
					>
						<option value="s2.1-pro-free">s2.1-pro-free (推荐免费层)</option>
						<option value="s1">s1</option>
					</select>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">全局默认音色 (voiceId)</label>
					<VoicePresetSelector
						presets={presets}
						value={voiceId}
						onChange={(p) => {
							const next = p?.voiceId ?? "";
							setVoiceId(next);
							handleSave({ voiceId: next });
						}}
						voiceLanguages={voiceLanguages}
						layout="row"
					/>
					{voiceId && (
						<div className="lv-set-help" style={{ marginTop: "6px" }}>
							当前默认音色：<code>{voiceId}</code>
							{(() => {
								const cur = presets.find((p) => p.voiceId === voiceId);
								return cur ? ` (${cur.label})` : "";
							})()}
						</div>
					)}
				</div>
			</div>

			{/* 模块 3：语音识别 ASR */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">③ 语音识别 (STT - 火山引擎)</h3>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">火山 ASR 凭证路径 (asrCredentialsFile)</label>
					<div className="lv-set-row">
						<input
							type="text"
							className="lv-set-input"
							value={asrFile}
							placeholder="例如：/root/.config/volc-asr/credentials.json"
							onChange={(e) => setAsrFile(e.target.value)}
						/>
						<button
							type="button"
							className="lv-set-btn lv-set-btn-primary"
							disabled={saving}
							onClick={() => handleSave({ asrCredentialsFile: asrFile })}
						>
							保存
						</button>
					</div>
					<div className="lv-set-help">
						JSON 格式，需包含 <code>apikey</code>（推荐）或 <code>appid</code> + <code>accessToken</code>。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">语音识别模式 (asrMode)</label>
					<select
						className="lv-set-select"
						value={asrMode}
						onChange={(e) => {
							setAsrMode(e.target.value);
							handleSave({ asrMode: e.target.value });
						}}
					>
						<option value="stream">流式 (推荐) — 边说边出字，说完约 0.7s 出结果；支持中文/英语自动识别</option>
						<option value="nostream">一次性 — 整句识别（延迟约 1.3s）；支持日语等 25 语种自动检测</option>
					</select>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">识别语言策略</label>
					<select
						className="lv-set-select"
						value={sttLang}
						onChange={(e) => {
							setSttLang(e.target.value);
							handleSave({ sttLanguage: e.target.value });
						}}
					>
						<option value="auto">自动多语种检测 (覆盖中文、日语、英语)</option>
						<option value="zh">强制锁定中文 (zh-CN)</option>
						<option value="ja">强制锁定日语 (ja-JP)</option>
						<option value="en">强制锁定英语 (en-US)</option>
					</select>
					{asrMode === "stream" && (
						<div className="lv-set-help">流式模式下语言自动检测中/英近方言，此处锁定仅在「一次性」模式生效。</div>
					)}
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">麦克风降噪 (noiseSuppression)</label>
					<select
						className="lv-set-select"
						value={micNs ? "on" : "off"}
						onChange={(e) => {
							const v = e.target.value === "on";
							setMicNs(v);
							handleSave({ micNoiseSuppression: v });
						}}
					>
						<option value="on">开启（浏览器降噪，默认）</option>
						<option value="off">关闭（原始麦克风信号）</option>
					</select>
					<div className="lv-set-help">关闭后采集原始音频（部分场景想用自己的处理/外接声卡时用）。</div>
				</div>
			</div>

			{/* 模块 4：语言对话与双语字幕 */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">④ 交流语言与双语字幕</h3>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">角色口头交流语言 (speechLanguage)</label>
					<select
						className="lv-set-select"
						value={speechLang}
						onChange={(e) => {
							setSpeechLang(e.target.value);
							handleSave({ speechLanguage: e.target.value });
						}}
					>
						<option value="auto">自动 (跟随用户语言，不限制角色语言)</option>
						<option value="ja">日语 (无论你说什么，角色均用日语自然交流)</option>
						<option value="zh">中文 (无论你说什么，角色均用中文交流)</option>
						<option value="en">English (Reply in English)</option>
					</select>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">字幕翻译目标语言 (subtitleLanguage)</label>
					<select
						className="lv-set-select"
						value={subLang}
						onChange={(e) => {
							setSubLang(e.target.value);
							handleSave({ subtitleLanguage: e.target.value });
						}}
					>
						<option value="zh">简体中文 (双语对照，角色外语回复自动译出中文字幕)</option>
						<option value="ja">日语</option>
						<option value="en">English</option>
						<option value="off">关闭翻译 (仅显示原声字幕)</option>
					</select>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">逐句字幕 (sentenceSubtitles)</label>
					<select
						className="lv-set-select"
						value={sentenceSubs ? "on" : "off"}
						onChange={(e) => {
							const next = e.target.value === "on";
							setSentenceSubs(next);
							handleSave({ sentenceSubtitles: next });
						}}
					>
						<option value="on">开启 (逐句合成语音，字幕逐句跟随发音)</option>
						<option value="off">关闭 (段落级合成，字幕按段落显示)</option>
					</select>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">自定义指令 (speechPrompt)</label>
					<textarea
						className="lv-set-textarea"
						rows={3}
						value={prompt}
						placeholder="例如：说话总是带点傲娇的调子，自称咱…"
						onChange={(e) => setPrompt(e.target.value)}
					/>
					<div style={{ marginTop: "6px" }}>
						<button
							type="button"
							className="lv-set-btn lv-set-btn-primary"
							disabled={saving}
							onClick={() => handleSave({ speechPrompt: prompt })}
						>
							保存提示词
						</button>
					</div>
					<div className="lv-set-help">
						仅在 Live2D 语音模式下注入；退出语音模式后自动撤除，无缝恢复普通编程对话。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">待机动作触发间隔 (idleInterval, 秒)</label>
					<select
						className="lv-set-select"
						value={String(idleSec)}
						onChange={(e) => {
							const next = Number(e.target.value);
							setIdleSec(next);
							handleSave({ idleInterval: next });
						}}
					>
						<option value="0">关闭 (仅呼吸+眨眼)</option>
						<option value="10">10 秒</option>
						<option value="20">20 秒 (默认)</option>
						<option value="30">30 秒</option>
						<option value="45">45 秒</option>
						<option value="60">60 秒</option>
						<option value="90">90 秒</option>
					</select>
					<div className="lv-set-help">
						角色长时间不互动时才轻微触发一次待机动作（系统提示词会同步告诉大模型当前可用的所有动作标签 [motion:xxx]）。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">视线模式 (gazeMode)</label>
					<select
						className="lv-set-select"
						value={gazeMode}
						onChange={(e) => {
							const next = e.target.value as "follow" | "natural";
							setGazeMode(next);
							handleSave({ gazeMode: next });
						}}
					>
						<option value="natural">自然 (活眼神：互视节奏、回避、头身微动)</option>
						<option value="follow">跟随 (旧行为：持续盯着用户)</option>
					</select>
					<div className="lv-set-help">
						自然模式下视线不再死盯：互视 0.5–3s、周期性移开、说话/倾听/思考各有注视节奏（参数可在 HUD ⚙ 的实验参数里调）。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">待机眼神微动 (idleGaze)</label>
					<select
						className="lv-set-select"
						value={idleGaze ? "on" : "off"}
						onChange={(e) => {
							const next = e.target.value === "on";
							setIdleGaze(next);
							handleSave({ idleGaze: next });
						}}
					>
						<option value="on">开启 (无摄像头时也有扫视/呼吸/微摆)</option>
						<option value="off">关闭 (无摄像头时保持静止)</option>
					</select>
					<div className="lv-set-help">
						关闭后，配合视线模式「跟随」即完全回到旧行为——HUD 面板的「自然行为」总开关可以一键完成这个操作。
					</div>
				</div>
			</div>

			{/* 模块 5：Live 模式专用模型 */}
			<DedicatedModelCard
				title="⑤ Live 模式专用模型"
				help="进入 Live2D 视图时自动切换到该模型，退出时自动切回原来的模型。留空（清除）则不自动切换。"
				modelCatalog={modelCatalog}
				saved={config?.liveModel}
				saving={saving}
				onSave={(v) => handleSave({ liveModel: v })}
			/>
			{/* 模块 6：翻译专用模型 */}
			<DedicatedModelCard
				title="⑥ 翻译专用模型"
				help="字幕翻译默认复用会话当前模型（若会话用的是思考模型会偏慢）。指定一个快速非思考模型可显著加快翻译出现时机；留空则跟随会话。"
				modelCatalog={modelCatalog}
				saved={config?.translateModel}
				saving={saving}
				onSave={(v) => handleSave({ translateModel: v })}
			/>
			{/* 模块 7：润色专用模型 */}
			<DedicatedModelCard
				title="⑦ 润色专用模型"
				help="第三人称模式下玩家台词的润色默认复用会话当前模型。指定专用模型可独立控制润色质量与速度；留空则跟随会话。"
				modelCatalog={modelCatalog}
				saved={config?.polishModel}
				saving={saving}
				onSave={(v) => handleSave({ polishModel: v })}
			/>
			{/* 模块 8：找更多模型与音色 */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">⑧ 找更多模型与音色</h3>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">Live2D 模型来源</label>
					<div className="lv-set-links">
						<a className="lv-set-link" href="https://www.live2d.com/zh-CHS/learn/sample/" target="_blank" rel="noreferrer">
							↗ Live2D 官方示例模型库（免费素材，本机 34 个模型的主要来源）
						</a>
						<a className="lv-set-link" href="https://github.com/Live2D/CubismNativeSamples/tree/main/Samples/Resources" target="_blank" rel="noreferrer">
							↗ Live2D GitHub 官方样例仓库 (CubismNativeSamples)
						</a>
						<a className="lv-set-link" href="https://github.com/Eikanya/Live2d-model" target="_blank" rel="noreferrer">
							↗ 第三方模型合集 Eikanya/Live2d-model（游戏提取，仅限个人学习，注意版权）
						</a>
					</div>
					<div className="lv-set-help">
						下载 zip 解压后，把含 <code>.model3.json</code> 的角色文件夹放进模型目录（默认
						<code>/root/.dsh/live2d-voice-models</code>），回本页点「刷新扫描」即可在 ① 与 HUD 中切换。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">Fish Audio 音色来源</label>
					<div className="lv-set-links">
						<a className="lv-set-link" href="https://fish.audio/zh-CN/discovery/" target="_blank" rel="noreferrer">
							↗ Fish Audio 公共音色库发现页（浏览 / 试听全部公开音色）
						</a>
						<a className="lv-set-link" href="https://docs.fish.audio/" target="_blank" rel="noreferrer">
							↗ Fish Audio 开发者文档（含公共音色库 API 检索方式）
						</a>
					</div>
					<div className="lv-set-help">
						音色详情页地址形如 <code>fish.audio/m/&#123;32位ID&#125;/</code>——把其中的 32 位十六进制 ID
						填入 ② 的默认音色，即可在 HUD 音色选择器中选用（或直接挑选已有预设）。
					</div>
				</div>
			</div>

			{/* 模块 9：第三人称模式 */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">⑨ 第三人称模式（玩家化身）</h3>
				</div>
				<div className="lv-set-help" style={{ marginBottom: "12px" }}>
					开启后，你的输入先润色成你角色的台词（可选），由<b>你的模型与音色</b>先说出来，AI 的角色再开口回应——像一场双人剧。
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">模式开关 (thirdPerson)</label>
					<select
						className="lv-set-select"
						value={thirdPerson ? "on" : "off"}
						onChange={(e) => {
							const next = e.target.value === "on";
							setThirdPerson(next);
							handleSave({ thirdPerson: next });
						}}
					>
						<option value="off">关闭（第一人称：输入直接交给 AI）</option>
						<option value="on">开启（第三人称：玩家化身先说，AI 再答）</option>
					</select>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">台词润色 / 翻译 (playerPolish)</label>
					<select
						className="lv-set-select"
						value={playerPolish ? "on" : "off"}
						onChange={(e) => {
							const next = e.target.value === "on";
							setPlayerPolish(next);
							handleSave({ playerPolish: next });
						}}
					>
						<option value="on">开启（口语 / 外语输入润色成角色台词）</option>
						<option value="off">关闭（原话直出）</option>
					</select>
					<div className="lv-set-help">润色使用当前会话的模型，保留全部信息点；关闭则你的原话就是台词。</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">玩家台词语言 (playerSpeechLanguage)</label>
					<select
						className="lv-set-select"
						value={playerLang}
						onChange={(e) => {
							setPlayerLang(e.target.value);
							handleSave({ playerSpeechLanguage: e.target.value });
						}}
					>
						<option value="auto">跟随输入语言</option>
						<option value="zh">简体中文</option>
						<option value="ja">日语</option>
						<option value="en">English</option>
					</select>
					<div className="lv-set-help">润色开启时，台词最终用这种语言说出（例：中文输入 → 日语台词）。</div>
				</div>
				{models.length > 0 && (
					<div className="lv-set-field">
						<label className="lv-set-label">玩家角色模型 (playerModelSelection)</label>
						<Live2DModelSelector
							models={models}
							value={playerModelSel}
							onChange={(modelName) => {
								setPlayerModelSel(modelName);
								handleSave({ playerModelSelection: modelName });
							}}
							allowEmpty={true}
							emptyLabel="— 无独立模型（仅音色）—"
							autoSelectFirstOnGroupChange={false}
							layout="row"
						/>
						<div className="lv-set-help" style={{ marginTop: "6px" }}>
							{playerModelSel ? `当前玩家模型：${playerModelSel}` : "不选则第三人称只有玩家音色（无独立模型）；双人同台时玩家居左、AI 居右。"}
						</div>
					</div>
				)}
				<div className="lv-set-field">
					<label className="lv-set-label">玩家音色 (playerVoiceId)</label>
					<VoicePresetSelector
						presets={presets}
						value={playerVoiceId}
						onChange={(p) => {
							const next = p?.voiceId ?? "";
							setPlayerVoiceId(next);
							handleSave({ playerVoiceId: next });
						}}
						voiceLanguages={voiceLanguages}
						layout="row"
					/>
					<div className="lv-set-help" style={{ marginTop: "6px" }}>
						{playerVoiceId === voiceId && (
							<span style={{ color: "var(--dsw-alias-state-warn-label, #f59e0b)", marginRight: "8px" }}>
								⚠️ 玩家音色与 AI 音色相同，建议选不同音色更好分辨。
							</span>
						)}
						玩家化身的 Fish Audio 音色；双人同台时用于区分玩家台词发音。
					</div>
				</div>
				<div className="lv-set-field">
					<label className="lv-set-label">玩家人设 (playerPrompt)</label>
					<textarea
						className="lv-set-textarea"
						rows={3}
						value={playerPrompt}
						placeholder="例如：元气少年，说话爽朗带点冲劲，偶尔用「学长」称呼对方…"
						onChange={(e) => setPlayerPrompt(e.target.value)}
					/>
					<div style={{ marginTop: "6px" }}>
						<button
							type="button"
							className="lv-set-btn lv-set-btn-primary"
							disabled={saving}
							onClick={() => handleSave({ playerPrompt })}
						>
							保存人设
						</button>
					</div>
					<div className="lv-set-help">润色时作为你角色的口吻参考；留空则只做通用润色。</div>
				</div>
			</div>
		</div>
	);
}
