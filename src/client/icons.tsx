import type { FC, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 18): SVGProps<SVGSVGElement> => ({
	width: size,
	height: size,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.8,
	strokeLinecap: "round",
	strokeLinejoin: "round",
	"aria-hidden": true,
	focusable: false,
});

/** 麦克风开启 (未禁用) */
export const IconMic: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
		<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
		<path d="M12 19v3" />
	</svg>
);

/** 麦克风静音/关闭 */
export const IconMicOff: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<line x1="2" y1="2" x2="22" y2="22" />
		<path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
		<path d="M5 10v2a7 7 0 0 0 12 5" />
		<path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
		<path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
		<path d="M12 19v3" />
	</svg>
);

/** 声音播放中 (正常音量) */
export const IconVolume: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
		<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
		<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
	</svg>
);

/** 静音状态 */
export const IconVolumeX: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
		<line x1="22" y1="9" x2="16" y2="15" />
		<line x1="16" y1="9" x2="22" y2="15" />
	</svg>
);

/** 字幕开关 */
export const IconCaptions: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<rect x="3" y="5" width="18" height="14" rx="3" />
		<path d="M7 15h4" />
		<path d="M15 15h2" />
		<path d="M7 11h3" />
		<path d="M14 11h3" />
	</svg>
);

/** 键盘文字输入 */
export const IconKeyboard: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<rect x="2" y="6" width="20" height="12" rx="2.5" />
		<circle cx="6" cy="10" r="0.8" fill="currentColor" />
		<circle cx="10" cy="10" r="0.8" fill="currentColor" />
		<circle cx="14" cy="10" r="0.8" fill="currentColor" />
		<circle cx="18" cy="10" r="0.8" fill="currentColor" />
		<path d="M7 14h10" />
	</svg>
);

/** 全屏按钮 */
export const IconMaximize: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M8 3H5a2 2 0 0 0-2 2v3" />
		<path d="M21 8V5a2 2 0 0 0-2-2h-3" />
		<path d="M3 16v3a2 2 0 0 0 2 2h3" />
		<path d="M16 21h3a2 2 0 0 0 2-2v-3" />
	</svg>
);

/** 退出全屏 */
export const IconMinimize: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M4 14h6v6" />
		<path d="M20 10h-6V4" />
		<path d="M14 10l7-7" />
		<path d="M10 14l-7 7" />
	</svg>
);

/** 快捷调节滑块 (代替生硬齿轮) */
export const IconSliders: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<line x1="4" y1="21" x2="4" y2="14" />
		<line x1="4" y1="10" x2="4" y2="3" />
		<line x1="12" y1="21" x2="12" y2="12" />
		<line x1="12" y1="8" x2="12" y2="3" />
		<line x1="20" y1="21" x2="20" y2="16" />
		<line x1="20" y1="12" x2="20" y2="3" />
		<line x1="1" y1="14" x2="7" y2="14" />
		<line x1="9" y1="8" x2="15" y2="8" />
		<line x1="17" y1="16" x2="23" y2="16" />
	</svg>
);

/** 全局设置齿轮 */
export const IconSettings: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
		<circle cx="12" cy="12" r="3" />
	</svg>
);

/** 外部链接 / 弹跳箭头 */
export const IconExternalLink: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		<polyline points="15 3 21 3 21 9" />
		<line x1="10" y1="14" x2="21" y2="3" />
	</svg>
);

/** 关闭 ✕ */
export const IconClose: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	</svg>
);

/** 勾选 ✓ */
export const IconCheck: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<polyline points="20 6 9 17 4 12" />
	</svg>
);

/** 刷新 */
export const IconRefresh: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
		<path d="M21 3v5h-5" />
		<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
		<path d="M3 21v-5h5" />
	</svg>
);

/** 旋转 Loading */
export const IconSpinner: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} className="lv-spin" {...rest}>
		<path d="M21 12a9 9 0 1 1-6.22-8.56" />
	</svg>
);

/** 警告 / 提示 */
export const IconAlert: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<circle cx="12" cy="12" r="10" />
		<line x1="12" y1="8" x2="12" y2="12" />
		<line x1="12" y1="16" x2="12.01" y2="16" />
	</svg>
);

/** 警告三角 (错误边界/异常) */
export const IconAlertTriangle: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
		<line x1="12" y1="9" x2="12" y2="13" />
		<line x1="12" y1="17" x2="12.01" y2="17" />
	</svg>
);

/** 复制图标 */
export const IconCopy: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</svg>
);

/** 发送箭头 (用于输入框) */
export const IconSend: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<line x1="22" y1="2" x2="11" y2="13" />
		<polygon points="22 2 15 22 11 13 2 9 22 2" />
	</svg>
);

/** 退出 Live 模式 (返回聊天) */
export const IconExitLive: FC<P> = ({ size, ...rest }) => (
	<svg {...base(size)} {...rest}>
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
		<polyline points="16 17 21 12 16 7" />
		<line x1="21" y1="12" x2="9" y2="12" />
	</svg>
);
