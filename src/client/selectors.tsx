import { useState, useEffect, useMemo, useRef } from "react";
import type {
	ModelCatalog,
	VoicePreset,
	LanguageOption,
} from "./types.js";
import { resolveVoice } from "./api.js";
import { VoiceLibrary } from "./voice-library.js";

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
// 2. VoicePresetSelector: 当前音色行 + 音色库入口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 音色 id → 标题的模块级缓存。
 *
 * 目录里没有的 id（手填的、或从音色库选了但没进过当前窗口的）也要有个说得出口的名字，
 * 不能一直显示 `6c777b9c…`。解析失败不是错误：仍可试听，只是回落短 id。
 */
const voiceTitles = new Map<string, string>();

export interface VoicePresetSelectorProps {
	/** 当前 voiceId（空 = 未设置）。 */
	value?: string;
	onChange: (preset: VoicePreset) => void;
	disabled?: boolean;
}

export function VoicePresetSelector({ value, onChange, disabled = false }: VoicePresetSelectorProps) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState(() => (value ? (voiceTitles.get(value) ?? "") : ""));

	useEffect(() => {
		if (!value) {
			setTitle("");
			return;
		}
		const cached = voiceTitles.get(value);
		if (cached) {
			setTitle(cached);
			return;
		}
		let alive = true;
		resolveVoice(value)
			.then((entry) => {
				voiceTitles.set(value, entry.title);
				if (alive) setTitle(entry.title);
			})
			.catch(() => {
				if (alive) setTitle("");
			});
		return () => {
			alive = false;
		};
	}, [value]);

	const label = value ? title || `自定义音色 (${value.slice(0, 8)}…)` : "未设置";

	return (
		<div className="lv-voice-picker">
			<button type="button" className="lv-voice-current" disabled={disabled} title="打开音色库" onClick={() => setOpen(true)}>
				<span className="lv-voice-name">{label}</span>
				<span className="lv-voice-hint">选择音色…</span>
			</button>
			{open && (
				<VoiceLibrary
					currentVoiceId={value}
					onClose={() => setOpen(false)}
					onPick={(entry) => {
						// 先把标题写进缓存：父层的 value 更新后这里立刻显示真名而不是短 id
						voiceTitles.set(entry.id, entry.title);
						setOpen(false);
						onChange({ id: entry.id, label: entry.title, voiceId: entry.id });
					}}
				/>
			)}
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
