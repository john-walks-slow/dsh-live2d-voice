/**
 * React ErrorBoundary for Live2D views.
 *
 * Prevents full-page unmounting / white-screen crashes when any descendant
 * component throws during render or lifecycle. Traps errors, reports them
 * to the diagnostic logger and server, and renders a fallback recovery card
 * with "Retry Reload" and "Copy Diagnostic Logs" actions.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "./logger.js";
import { IconAlertTriangle, IconRefresh, IconCopy } from "./icons.js";

interface Props {
	fallbackTitle?: string;
	onReset?: () => void;
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
	copied: boolean;
	showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
	override state: State = {
		hasError: false,
		error: null,
		copied: false,
		showDetails: false,
	};

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		logger.error(`Live2D render crashed: ${error.message}`, {
			stack: error.stack,
			componentStack: errorInfo.componentStack,
		});
	}

	private handleRetry = () => {
		this.setState({ hasError: false, error: null, copied: false, showDetails: false });
		this.props.onReset?.();
	};

	private handleCopy = async () => {
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
			this.setState({ copied: true });
			window.setTimeout(() => this.setState({ copied: false }), 3000);
		} catch (err) {
			logger.warn("Failed to copy diagnostic logs to clipboard", err);
		}
	};

	override render(): ReactNode {
		if (this.state.hasError) {
			const err = this.state.error;
			return (
				<div className="lv-root" data-no-gesture>
					<div className="lv-center">
						<div className="lv-card lv-card-error">
							<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8, color: "#f87171" }}>
								<IconAlertTriangle size={22} />
								<b style={{ color: "#f87171", fontSize: 16 }}>{this.props.fallbackTitle ?? "Live2D 页面遇到异常"}</b>
							</div>
							<div style={{ margin: "8px 0", color: "var(--lv-fg-2)", fontSize: 13, wordBreak: "break-all" }}>
								{err?.message || "未知渲染错误"}
							</div>

							<div className="lv-card-actions">
								<button type="button" className="lv-card-btn lv-card-btn-primary" onClick={this.handleRetry}>
									<IconRefresh size={14} />
									<span>重新加载</span>
								</button>
								<button type="button" className="lv-card-btn" onClick={() => void this.handleCopy()}>
									<IconCopy size={14} />
									<span>{this.state.copied ? "已复制日志 ✓" : "复制排查日志"}</span>
								</button>
								<button
									type="button"
									className="lv-card-btn"
									onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
								>
									<span>{this.state.showDetails ? "收起详情" : "展开堆栈"}</span>
								</button>
							</div>

							{this.state.showDetails && (
								<pre className="lv-card-logs">
									{err?.stack || "无堆栈信息"}
								</pre>
							)}
						</div>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}
