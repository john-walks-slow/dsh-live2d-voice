import { useState, useEffect, useCallback } from "react";
import type { PublicConfig, VoicePreset, LanguageOption, ModelCatalog, ModelProviderGroup, ModelCatalogModel } from "./types.js";
import { fetchConfig, saveConfig, fetchModelCatalog } from "./api.js";
import {
	IconRefresh,
	IconCheck,
	IconAlert,
} from "./icons.js";

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

.lv-set-input, .lv-set-select, .lv-set-textarea {
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
	transition: border-color 0.15s ease;
}

body[data-ds-dark-theme] .lv-set-input,
body[data-ds-dark-theme] .lv-set-select,
body[data-ds-dark-theme] .lv-set-textarea {
	background: var(--dsw-alias-bg-layer-1, #151517);
	border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
}

.lv-set-input:focus, .lv-set-select:focus, .lv-set-textarea:focus {
	border-color: var(--dsw-alias-state-business-primary, #4176e6);
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
	const [models, setModels] = useState<{ name: string; label?: string; url: string }[]>([]);
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
	const [sttLang, setSttLang] = useState("auto");
	const [asrMode, setAsrMode] = useState("stream");
	const [micNs, setMicNs] = useState(true);
	const [prompt, setPrompt] = useState("");
	const [saving, setSaving] = useState(false);
	// Live model auto-switch config
	const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
	const [liveProvider, setLiveProvider] = useState("");
	const [liveModelId, setLiveModelId] = useState("");
	const [liveEffort, setLiveEffort] = useState("");

	const loadAll = useCallback(() => {
		setLoading(true);
		fetchConfig()
			.then((data: { config: PublicConfig; presets: VoicePreset[]; languages: LanguageOption[] }) => {
				setConfig(data.config);
				setPresets(data.presets || []);
				setModelPath(data.config.modelPath || "");
				setVoiceId(data.config.voiceId || "");
				setTtsModel(data.config.ttsModel || "s2.1-pro-free");
				setApiKeyFile(data.config.apiKeyFile || "");
				setAsrFile(data.config.asrCredentialsFile || "");
				setSpeechLang(data.config.speechLanguage || "ja");
				setSubLang(data.config.subtitleLanguage || "zh");
				setSttLang(data.config.sttLanguage || "auto");
				setAsrMode(data.config.asrMode || "stream");
				setMicNs(data.config.micNoiseSuppression !== false);
				setPrompt(data.config.speechPrompt || "");
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

	// When config loads, populate live model drafts from saved config
	useEffect(() => {
		if (config?.liveModel) {
			setLiveProvider(config.liveModel.provider || "");
			setLiveModelId(config.liveModel.model || "");
			setLiveEffort(config.liveModel.reasoningEffort || "");
		}
	}, [config]);

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

	// Derived: the provider group and model currently selected in the live-model picker
	const liveGroup = modelCatalog?.groups.find((g) => g.id === liveProvider) ?? null;
	const liveModelObj = liveGroup?.models.find((m) => m.id === liveModelId) ?? null;

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
						<label className="lv-set-label">已扫描到的可用模型 ({models.length} 个)</label>
						<div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
							{models.map((m) => (
								<button
									key={m.name}
									type="button"
									title={m.name}
									className={`lv-set-btn ${config?.modelSelection === m.name ? "lv-set-btn-primary" : ""}`}
									onClick={() => handleSave({ modelSelection: m.name })}
								>
									{m.label ?? m.name} {config?.modelSelection === m.name ? "✓" : ""}
								</button>
							))}
						</div>
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
					<div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
						{presets.map((p) => (
							<button
								key={p.id}
								type="button"
								className={`lv-set-btn ${voiceId === p.voiceId ? "lv-set-btn-primary" : ""}`}
								onClick={() => {
									setVoiceId(p.voiceId);
									handleSave({ voiceId: p.voiceId });
								}}
							>
								{p.label} {voiceId === p.voiceId ? "✓" : ""}
							</button>
						))}
					</div>
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
			</div>

			{/* 模块 5：Live 模式专用模型 */}
			<div className="lv-set-card">
				<div className="lv-set-card-head">
					<h3 className="lv-set-card-title">⑤ Live 模式专用模型</h3>
				</div>
				<div className="lv-set-help" style={{ marginBottom: "12px" }}>
					进入 Live2D 视图时自动切换到该模型，退出时自动切回原来的模型。留空（清除）则不自动切换。
				</div>
				{modelCatalog ? (
					<>
						<div className="lv-set-field">
							<label className="lv-set-label">模型供应商</label>
							<select
								className="lv-set-select"
								value={liveProvider}
								onChange={(e) => {
									setLiveProvider(e.target.value);
									const grp = modelCatalog.groups.find((g) => g.id === e.target.value);
									setLiveModelId(grp?.models[0]?.id ?? "");
									setLiveEffort(grp?.models[0]?.reasoning?.defaultEffort ?? "");
								}}
							>
								<option value="">— 选择供应商 —</option>
								{modelCatalog.groups.map((g) => (
									<option key={g.id} value={g.id}>{g.name}</option>
								))}
							</select>
						</div>
						{liveGroup && (
							<div className="lv-set-field">
								<label className="lv-set-label">模型</label>
								<select
									className="lv-set-select"
									value={liveModelId}
									onChange={(e) => {
										setLiveModelId(e.target.value);
										const m = liveGroup.models.find((mm) => mm.id === e.target.value);
										setLiveEffort(m?.reasoning?.defaultEffort ?? "");
									}}
								>
									<option value="">— 选择模型 —</option>
									{liveGroup.models.map((m) => (
										<option key={m.id} value={m.id}>{m.name}</option>
									))}
								</select>
							</div>
						)}
						{liveModelObj?.reasoning && liveModelObj.reasoning.efforts.length > 0 && (
							<div className="lv-set-field">
								<label className="lv-set-label">思考程度</label>
								<select
									className="lv-set-select"
									value={liveEffort}
									onChange={(e) => setLiveEffort(e.target.value)}
								>
									<option value="">默认</option>
									{liveModelObj.reasoning.efforts.map((eff) => (
										<option key={eff.id} value={eff.id}>{eff.name}</option>
									))}
								</select>
							</div>
						)}
						<div className="lv-set-row" style={{ marginTop: "8px" }}>
							<button
								type="button"
								className="lv-set-btn lv-set-btn-primary"
								disabled={saving || !liveProvider || !liveModelId}
								onClick={() =>
									handleSave({
										liveModel: {
											provider: liveProvider,
											model: liveModelId,
											...(liveEffort ? { reasoningEffort: liveEffort } : {}),
										},
									})
								}
							>
								保存
							</button>
							<button
								type="button"
								className="lv-set-btn"
								disabled={saving || !config?.liveModel}
								onClick={() => {
									setLiveProvider("");
									setLiveModelId("");
									setLiveEffort("");
									handleSave({ liveModel: null });
								}}
							>
								清除
							</button>
							{config?.liveModel && (
								<span style={{ fontSize: "12px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
									已设置：{config.liveModel.provider} / {config.liveModel.model}
									{config.liveModel.reasoningEffort ? ` / ${config.liveModel.reasoningEffort}` : ""}
								</span>
							)}
						</div>
					</>
				) : (
					<div className="lv-set-help">
						模型目录加载中或不可用（需 DSH 重启后加载新路由）。
					</div>
				)}
			</div>
		{/* 模块 6：找更多模型与音色 */}
				<div className="lv-set-card">
					<div className="lv-set-card-head">
						<h3 className="lv-set-card-title">⑥ 找更多模型与音色</h3>
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
		</div>
	);
}
