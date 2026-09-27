import { useState, useEffect, useMemo, useRef } from "react";
import type {
	ModelCatalog,
	VoicePreset,
	LanguageOption,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Live2DModelSelector: 分类与角色模型二级选择器
// ─────────────────────────────────────────────────────────────────────────────

export interface Live2DModelItem {
	name: string;
	label?: string;
	kind?: "moc2" | "moc3";
	group?: string;
	groupLabel?: string;
	url?: string;
}

export interface Live2DModelSelectorProps {
	models: Live2DModelItem[];
	value?: string;
	onChange: (modelName: string) => void;
	allowEmpty?: boolean;
	emptyLabel?: string;
	autoSelectFirstOnGroupChange?: boolean;
	disabled?: boolean;
	layout?: "stack" | "row";
	className?: string;
}

export function Live2DModelSelector({
	models,
	value,
	onChange,
	allowEmpty = false,
	emptyLabel = "— 无独立模型（仅音色）—",
	autoSelectFirstOnGroupChange = true,
	disabled = false,
	layout = "stack",
	className = "",
}: Live2DModelSelectorProps) {
	// 构建分组列表
	const groups = useMemo(() => {
		const list: { id: string; label: string; items: Live2DModelItem[] }[] = [];
		for (const m of models) {
			const id = m.group ?? "";
			const label = m.groupLabel || m.group || "未分类";
			let g = list.find((x) => x.id === id);
			if (!g) {
				g = { id, label, items: [] };
				list.push(g);
			}
			g.items.push(m);
		}
		return list;
	}, [models]);

	// 计算当前选中的模型所归属的分类
	const currentModelItem = models.find((m) => m.name === value);
	const initialGroupId = currentModelItem?.group ?? (groups[0]?.id ?? "");
	const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);

	// 记录上一轮受控 value，仅在外部受控 value 真正发生变更时，才自动同步切换 selectedGroupId
	// 避免在用户手动切换分类（autoSelectFirstOnGroupChange=false）时被 effect 强行弹回（BLK-01）
	const prevValueRef = useRef(value);
	useEffect(() => {
		if (prevValueRef.current !== value) {
			prevValueRef.current = value;
			if (currentModelItem?.group !== undefined) {
				setSelectedGroupId(currentModelItem.group);
			}
		} else if (groups.length > 0 && !selectedGroupId) {
			// 仅在首次异步数据到达且本地尚无 selectedGroupId 时兜底匹配当前模型或首个分组（REC-02）
			setSelectedGroupId(currentModelItem?.group ?? groups[0].id);
		}
	}, [value, currentModelItem?.group, groups, selectedGroupId]);

	// 当前分类下的模型列表
	const filteredModels = useMemo(() => {
		return models.filter((m) => (m.group ?? "") === selectedGroupId);
	}, [models, selectedGroupId]);

	const isValueInCurrentGroup = filteredModels.some((m) => m.name === value);

	const handleGroupChange = (newGroupId: string) => {
		setSelectedGroupId(newGroupId);
		if (autoSelectFirstOnGroupChange) {
			const firstInGroup = models.find((m) => (m.group ?? "") === newGroupId);
			if (firstInGroup && firstInGroup.name !== value) {
				onChange(firstInGroup.name);
			}
		}
	};

	const groupClass = layout === "row" ? "lv-select-group lv-select-group-row" : "lv-select-group";

	return (
		<div className={`${groupClass} ${className}`.trim()}>
			{groups.length > 1 && (
				<select
					className="lv-model-select"
					disabled={disabled}
					value={selectedGroupId}
					onChange={(e) => handleGroupChange(e.target.value)}
					title="角色分类"
				>
					{groups.map((g) => (
						<option key={g.id || "uncategorized"} value={g.id}>
							{g.label || "未分类"} ({g.items.length})
						</option>
					))}
				</select>
			)}
			<select
				className="lv-model-select"
				disabled={disabled}
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value)}
				title="角色模型"
			>
				{allowEmpty && <option value="">{emptyLabel}</option>}
				{/* 若当前选中的模型不在当前切换的分类下，显示提示占位，value 与受控 select 精准匹配（REC-01） */}
				{!isValueInCurrentGroup && value && (
					<option value={value} disabled hidden>
						— 请选择此分类下的角色 —
					</option>
				)}
				{filteredModels.map((m) => (
					<option key={m.name} value={m.name}>
						{m.label ?? m.name}
						{m.kind === "moc2" ? "（旧版）" : ""}
					</option>
				))}
			</select>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. VoicePresetSelector: 语言与音色二级选择器
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_VOICE_LANGS: LanguageOption[] = [
	{ id: "all", label: "全部语言" },
	{ id: "zh", label: "中文" },
	{ id: "ja", label: "日语" },
	{ id: "en", label: "英语" },
];

export interface VoicePresetSelectorProps {
	presets: VoicePreset[];
	value?: string;
	onChange: (preset: VoicePreset | null) => void;
	voiceLanguages?: LanguageOption[];
	currentLang?: string;
	onLangChange?: (lang: string) => void;
	allowEmpty?: boolean;
	emptyLabel?: string;
	disabled?: boolean;
	layout?: "stack" | "row";
	className?: string;
}

export function VoicePresetSelector({
	presets,
	value,
	onChange,
	voiceLanguages,
	currentLang,
	onLangChange,
	allowEmpty = false,
	emptyLabel = "— 默认音色 —",
	disabled = false,
	layout = "stack",
	className = "",
}: VoicePresetSelectorProps) {
	const langs = voiceLanguages && voiceLanguages.length > 0 ? voiceLanguages : DEFAULT_VOICE_LANGS;

	// 若未提供外部受控 currentLang，则内部自主维护
	const [internalLang, setInternalLang] = useState("all");
	const activeLang = currentLang ?? internalLang;

	const handleLangChange = (newLang: string) => {
		if (onLangChange) {
			onLangChange(newLang);
		} else {
			setInternalLang(newLang);
		}
	};

	const filteredPresets = useMemo(() => {
		return presets.filter((preset) => {
			if (activeLang === "all") return true;
			const lang = (preset as VoicePreset & { lang?: string }).lang;
			if (!lang) return activeLang === "zh";
			return lang === activeLang;
		});
	}, [presets, activeLang]);

	const currentPreset = presets.find((p) => p.voiceId === value);
	const isInFiltered = filteredPresets.some((p) => p.voiceId === value);

	const groupClass = layout === "row" ? "lv-select-group lv-select-group-row" : "lv-select-group";

	return (
		<div className={`${groupClass} ${className}`.trim()}>
			{langs.length > 1 && (
				<select
					className="lv-model-select"
					disabled={disabled}
					value={activeLang}
					onChange={(e) => handleLangChange(e.target.value)}
					title="音色语言"
				>
					{langs.map((l) => (
						<option key={l.id} value={l.id}>
							{l.label}
						</option>
					))}
				</select>
			)}
			<select
				className="lv-model-select"
				disabled={disabled}
				value={value ?? ""}
				onChange={(e) => {
					const val = e.target.value;
					if (!val) {
						onChange(null);
						return;
					}
					const hit = presets.find((p) => p.voiceId === val);
					if (hit) {
						onChange(hit);
					} else {
						// 针对手填或自定义的 32 位 ID 进行兜底（REC-04）
						onChange({ id: val, label: `自定义 (${val.slice(0, 8)}…)`, voiceId: val });
					}
				}}
				title="预设音色"
			>
				{allowEmpty && <option value="">{emptyLabel}</option>}
				{/* 若当前值不在预设中，渲染自定义音色项（REC-04） */}
				{value && !presets.some((p) => p.voiceId === value) && (
					<option value={value}>自定义音色 ({value.slice(0, 8)}…)</option>
				)}
				{!isInFiltered && currentPreset && (
					<option value={currentPreset.voiceId}>{currentPreset.label} (当前)</option>
				)}
				{filteredPresets.map((p) => (
					<option key={p.id} value={p.voiceId}>
						{p.label}
					</option>
				))}
			</select>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LlmModelSelector: LLM 模型与思考程度选择器
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmModelSelectionValue {
	provider: string;
	model: string;
	reasoningEffort?: string;
}

export interface LlmModelSelectorProps {
	catalog: ModelCatalog;
	value?: LlmModelSelectionValue | null;
	onChange: (value: LlmModelSelectionValue | null) => void;
	disabled?: boolean;
	allowClear?: boolean;
	clearLabel?: string;
	placeholder?: string;
	layout?: "stack" | "row";
	className?: string;
}

export function LlmModelSelector({
	catalog,
	value,
	onChange,
	disabled = false,
	allowClear = false,
	clearLabel = "— 跟随会话 —",
	placeholder,
	layout = "stack",
	className = "",
}: LlmModelSelectorProps) {
	const currentProvider = value?.provider ?? (allowClear || placeholder ? "" : catalog.default.provider);
	const currentModel = value?.model ?? (allowClear || placeholder ? "" : catalog.default.model);
	const currentEffort = value?.reasoningEffort;

	const selectedGroup = catalog.groups.find((g) => g.id === currentProvider);
	const selectedModel = selectedGroup?.models.find((m) => m.id === currentModel);
	const efforts = selectedModel?.reasoning?.efforts ?? [];
	const effectiveEffort = currentEffort ?? selectedModel?.reasoning?.defaultEffort;

	const currentValueStr = currentProvider && currentModel ? `${currentProvider}:${currentModel}` : "";

	const handleModelChange = (composedValue: string) => {
		if (!composedValue) {
			onChange(null);
			return;
		}
		const sep = composedValue.indexOf(":");
		if (sep < 0) return;
		const provider = composedValue.slice(0, sep);
		const model = composedValue.slice(sep + 1);
		const grp = catalog.groups.find((g) => g.id === provider);
		const mObj = grp?.models.find((m) => m.id === model);
		const defaultEffort = mObj?.reasoning?.defaultEffort;
		onChange({
			provider,
			model,
			...(defaultEffort ? { reasoningEffort: defaultEffort } : {}),
		});
	};

	const handleEffortChange = (effort: string) => {
		if (!currentProvider || !currentModel) return;
		onChange({
			provider: currentProvider,
			model: currentModel,
			...(effort ? { reasoningEffort: effort } : {}),
		});
	};

	const groupClass = layout === "row" ? "lv-select-group lv-select-group-row" : "lv-select-group";

	return (
		<div className={`${groupClass} ${className}`.trim()}>
			<select
				className="lv-model-select"
				disabled={disabled}
				value={currentValueStr}
				onChange={(e) => handleModelChange(e.target.value)}
				title="模型选择"
			>
				{placeholder && !value && (
					<option value="" disabled hidden>
						{placeholder}
					</option>
				)}
				{allowClear && <option value="">{clearLabel}</option>}
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
					disabled={disabled}
					value={effectiveEffort ?? ""}
					onChange={(e) => handleEffortChange(e.target.value)}
					title="思考程度"
				>
					<option value="">默认思考程度</option>
					{efforts.map((eff) => (
						<option key={eff.id} value={eff.id}>
							{eff.name}
						</option>
					))}
				</select>
			)}
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DedicatedModelCard: 用于设置页的统一专用模型卡片
// ─────────────────────────────────────────────────────────────────────────────

export interface DedicatedModelCardProps {
	title: string;
	help: string;
	modelCatalog: ModelCatalog | null;
	saved?: LlmModelSelectionValue | null;
	saving: boolean;
	onSave: (value: LlmModelSelectionValue | null) => void;
}

export function DedicatedModelCard({
	title,
	help,
	modelCatalog,
	saved,
	saving,
	onSave,
}: DedicatedModelCardProps) {
	const [draft, setDraft] = useState<LlmModelSelectionValue | null>(saved ?? null);

	useEffect(() => {
		setDraft(saved ?? null);
	}, [saved]);

	const isDirty =
		(draft?.provider ?? "") !== (saved?.provider ?? "") ||
		(draft?.model ?? "") !== (saved?.model ?? "") ||
		(draft?.reasoningEffort ?? "") !== (saved?.reasoningEffort ?? "");

	return (
		<div className="lv-set-card">
			<div className="lv-set-card-head">
				<h3 className="lv-set-card-title">{title}</h3>
			</div>
			<div className="lv-set-help" style={{ marginBottom: "12px" }}>
				{help}
			</div>
			{modelCatalog ? (
				<>
					<div className="lv-set-field">
						<label className="lv-set-label">模型与思考程度</label>
						<LlmModelSelector
							catalog={modelCatalog}
							value={draft}
							onChange={setDraft}
							disabled={saving}
							allowClear={false}
							placeholder="— 未配置（点击选择专用模型）—"
							layout="row"
						/>
					</div>
					<div className="lv-set-row" style={{ marginTop: "8px" }}>
						<button
							type="button"
							className="lv-set-btn lv-set-btn-primary"
							disabled={saving || !draft?.provider || !draft?.model || !isDirty}
							onClick={() => onSave(draft)}
						>
							保存
						</button>
						<button
							type="button"
							className="lv-set-btn"
							disabled={saving || !saved}
							onClick={() => {
								setDraft(null);
								onSave(null);
							}}
						>
							清除（跟随会话）
						</button>
						{saved ? (
							<span style={{ fontSize: "12px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
								已设置：{saved.provider} / {saved.model}
								{saved.reasoningEffort ? ` / ${saved.reasoningEffort}` : ""}
							</span>
						) : (
							<span style={{ fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
								当前跟随会话模型
							</span>
						)}
					</div>
				</>
			) : (
				<div className="lv-set-help">模型目录加载中或不可用（需 DSH 重启后加载新路由）。</div>
			)}
		</div>
	);
}
