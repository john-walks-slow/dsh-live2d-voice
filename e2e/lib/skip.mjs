/**
 * 套件前置不满足时的 skip 语义（261010 约定，见 docs/references/260927-e2e-testing.md）。
 *
 * 有些套件需要实例里存在**真实 chat 会话**或完整 GUI 状态（会话行 → "Live2D" 页签、
 * 设置卡渲染）。最小 e2e 实例里这些前置天然不存在，过去会以 waitForSelector 超时
 * 失败收场——三片红全是环境问题，却要人肉逐条排除，还容易掩盖真回归。
 *
 * 约定：前置不满足 → 打印 `SKIP <suite>: <缺少什么>` 并 **exit 77**；
 * `e2e/run.mjs` 把 77 记为 SKIP（不算失败），汇总里单独列出。
 * 真实 API 类前置永远不为了"跑通"而现场制造（e2e 铁律 #3），只能 skip。
 */

export const SKIP_EXIT_CODE = 77;

/**
 * @param suite 套件名（与文件名一致，便于汇总对账）
 * @param reason 缺少的前置，一句话说清"为什么这里跑不了、需要什么"
 */
export function skip(suite, reason) {
	console.log(`SKIP ${suite}: ${reason}`);
	process.exit(SKIP_EXIT_CODE);
}
