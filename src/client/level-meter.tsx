import type { FC } from "react";

export interface LevelMeterProps {
	/** 0..1 实时音量电平 */
	level: number;
	/** 状态模式：normal 正常采样 | pulsing 识别中脉冲 | muted 静音淡化 */
	mode?: "normal" | "pulsing" | "muted";
}

/**
 * 5 根圆角竖条构成的声波指示器。
 * 替代此前刺眼的红圆点与三色进度条。
 */
export const LevelMeter: FC<LevelMeterProps> = ({ level, mode = "normal" }) => {
	// 5 根条基底权重分布，形成中间高两边低的自然声浪弧线
	const weights = [0.35, 0.75, 1.0, 0.75, 0.35];

	return (
		<div className={`lv-meter lv-meter-${mode}`} aria-hidden="true">
			{weights.map((w, i) => {
				// level 经过加权后映射到高度 4px .. 22px
				const clampedLevel = Math.max(0, Math.min(1, level));
				const h = mode === "pulsing" ? 10 : Math.max(4, Math.round(clampedLevel * 20 * w) + 4);
				return (
					<span
						key={i}
						className="lv-meter-bar"
						style={{ height: `${h}px`, animationDelay: `${i * 120}ms` }}
					/>
				);
			})}
		</div>
	);
};
