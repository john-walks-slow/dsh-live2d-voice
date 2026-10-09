#!/usr/bin/env node
/**
 * e2e 模块化运行器 (Modular E2E Runner)
 *
 * 核心设计原则：
 * 1. 业务模块化：按模块隔离运行，修改哪个模块只测哪个模块，严禁全量遍历无关历史用例。
 * 2. 真实 API 孤立：需要真实调用 LLM / TTS / ASR 的套件单独归类（real-api），默认不混入日常开发，推荐单点单跑。
 *
 * 用法：
 *   node e2e/run.mjs <module>        # 运行指定模块的全部套件，如: node e2e/run.mjs gaze
 *   node e2e/run.mjs <suite_name>    # 单点运行指定套件，如: node e2e/run.mjs verify-boot
 *   node e2e/run.mjs --list          # 查看所有业务模块与测试套件清单
 *   node e2e/run.mjs real-api        # 运行真实外部 API 套件（需确认成本与网络）
 */
import { execSync, spawnSync } from 'node:child_process';

export const MODULES = {
	boot: {
		description: '启动流程、会话入口与卸载清理',
		suites: ['verify-boot', 'verify-standalone', 'verify-unload-cleanup'],
	},
	fullscreen: {
		description: '全屏、虚拟键盘与移动端适配',
		suites: [
			'verify-fullscreen-usable',
			'verify-fullscreen-keyboard',
			'verify-keyboard-squish',
			'verify-standalone-fullscreen',
		],
	},
	gaze: {
		description: '视线追踪、数学计算、参数解析、点击互动、触摸模式与调节滑块',
		suites: ['verify-look-math', 'verify-look-sliders', 'verify-param-ids', 'verify-tap', 'verify-touch-mode'],
	},
	settings: {
		description: '设置面板、模型与音色库',
		suites: ['verify-settings-model', 'verify-voice-library'],
	},
	styles: {
		description: '样式注入与插件间 CSS 认领隔离',
		suites: ['verify-style-claim'],
	},
	'third-person': {
		description: '第三人称双角色同台与事件防重',
		suites: ['verify-third-person', 'verify-nodup'],
	},
};

// 需消耗真实外部 API (LLM/TTS/ASR) 的重套件。仅支持单跑或通过 real-api 显式触发。
export const REAL_API_SUITES = [
	'verify-live',
	'verify-voice',
	'verify-stream',
	'verify-asr',
	'verify-phase3',
	'verify-translation-race',
	'verify-soak',
	'verify-v11',
	'verify-inject',
];

const rawArg = process.argv[2];

if (!rawArg || rawArg === '--help' || rawArg === '-h' || rawArg === '--list') {
	console.log('=== dsh-live2d-voice 模块化 E2E 测试 ===\n');
	console.log('可用业务模块 (日常开发按需选择)：');
	for (const [mod, def] of Object.entries(MODULES)) {
		console.log(`  • ${mod.padEnd(14)} : ${def.description}`);
		console.log(`    套件: ${def.suites.join(', ')}`);
	}
	console.log('\n真实 API 孤立套件 (消耗 Token/外部网络，严禁日常无差别运行，推荐单点测试)：');
	console.log(`  • real-api       : ${REAL_API_SUITES.join(', ')}`);
	console.log('\n使用示例：');
	console.log('  node e2e/run.mjs gaze           # 只测视线模块');
	console.log('  node e2e/run.mjs fullscreen     # 只测全屏模块');
	console.log('  node e2e/run.mjs verify-boot    # 单点测某个套件');
	console.log('  node e2e/run.mjs verify-live    # 单点测真实语音全链路');
	process.exit(rawArg ? 0 : 2);
}

let suitesToRun = [];

if (rawArg === 'light') {
	// 向后兼容旧 light 命令：合并所有常规模块套件
	console.log('提示: "light" 模式已升级为模块化测试。本次将运行全部常规业务模块。');
	suitesToRun = Object.values(MODULES).flatMap((m) => m.suites);
} else if (rawArg === 'heavy' || rawArg === 'real-api') {
	console.log('⚠️  正在拉起【真实外部 API】测试集。将消耗真实 LLM / TTS / ASR 配额并依赖外部网络！');
	suitesToRun = REAL_API_SUITES;
} else if (MODULES[rawArg]) {
	console.log(`[模块测试] 命中模块: ${rawArg} (${MODULES[rawArg].description})`);
	suitesToRun = MODULES[rawArg].suites;
} else {
	// 指定具体套件名 (单跑或多跑)
	suitesToRun = process.argv.slice(2).map((n) => n.replace(/\.mjs$/, '').replace(/^e2e\//, ''));
}

// 去重
suitesToRun = [...new Set(suitesToRun)];

/**
 * 浏览器兜底清理（261010 教训：一次卡住的 e2e 留下 11 个 chromium、十一分钟零产出）。
 *
 * 回收条件必须**同时**成立，宁可留残骸也不误杀别人在跑的活服务：
 *   1. 可执行文件是 playwright 缓存里的那个 chromium（本机只有 e2e/playwright 用它）；
 *   2. 命令行带 `--remote-debugging-pipe`（playwright 的启动特征，不是常驻浏览器服务）；
 *   3. `ppid == 1`（启动者已消失，说明是我们这轮留下的孤儿）；
 *   4. 不在本进程启动时的基线集合里（别人的进程即使看着像孤儿也不碰）。
 * 命中后先 SIGTERM，1 秒后仍活着才 SIGKILL。
 * 环境假设：本机没有以 chromium 形式常驻的浏览器服务（sv/supervisord 里没有 chromium 项，
 * 现存的 chromium 全部来自 playwright 启动）——若将来引入常驻浏览器服务，条件 1/2 需重审。
 */
const CHROME_PATTERN = 'chrome-linux-arm64/chrom[e]';
// 上限按**浏览器实例数**（root 进程）算，不按进程数：一个 chromium 会带 ~10 个 helper 进程。
// 别人（其它 worktree）正在跑的浏览器也有 root，所以上限只做护栏、可用环境变量放宽。
const MAX_RESIDENT_BROWSERS = Number(process.env.DSH_E2E_MAX_BROWSERS ?? 3);
const chromiumProcs = () => {
	try {
		const out = execSync(`ps -eo pid=,ppid=,args= | grep '${CHROME_PATTERN}' || true`, { encoding: 'utf8' });
		return out.split('\n').map((line) => {
			const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
			return m ? { pid: Number(m[1]), ppid: Number(m[2]), args: m[3] } : null;
		}).filter(Boolean);
	} catch {
		return [];
	}
};
const isPlaywrightChromium = (p) =>
	p.args.includes('chrome-linux-arm64/chrome') && p.args.includes('--remote-debugging-pipe');
const BASELINE_CHROMIUM = new Set(chromiumProcs().map((p) => p.pid));
const reapOrphanChromium = (label) => {
	const orphans = chromiumProcs().filter((p) =>
		isPlaywrightChromium(p) && p.ppid === 1 && !BASELINE_CHROMIUM.has(p.pid));
	for (const p of orphans) {
		try { process.kill(p.pid, 'SIGTERM'); } catch { /* 已退出 */ }
	}
	if (!orphans.length) return 0;
	execSync('sleep 1');
	let killed = 0;
	for (const p of orphans) {
		try { process.kill(p.pid, 0); process.kill(p.pid, 'SIGKILL'); killed++; } catch { /* SIGTERM 已生效 */ }
	}
	console.log(`[e2e] ${label}: 回收 ${orphans.length} 个孤儿 chromium (${orphans.map((p) => p.pid).join(', ')})${killed ? `，其中 ${killed} 个需 SIGKILL` : ''}`);
	return orphans.length;
};

reapOrphanChromium('启动前');
const residentRoots = chromiumProcs().filter((p) => isPlaywrightChromium(p) && !p.args.includes('--type=')).length;
if (residentRoots > MAX_RESIDENT_BROWSERS) {
	console.error(`[e2e] 常驻浏览器实例 = ${residentRoots} > 上限 ${MAX_RESIDENT_BROWSERS}（含别的 worktree 正在跑的那种）；先看清再跑：`);
	console.error("      ps -eo pid=,ppid=,etime=,args= | grep 'chrom[e]-linux-arm64/chrome ' | grep -v -- '--type='");
	console.error("      确认是别人在跑且本机内存够，可放宽：DSH_E2E_MAX_BROWSERS=6 node e2e/run.mjs <suite>");
	process.exit(3);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => { reapOrphanChromium(sig); process.exit(130); });
}
process.on('exit', () => reapOrphanChromium('退出'));

console.log(`准备运行 ${suitesToRun.length} 个套件: ${suitesToRun.join(', ')}\n`);

const summary = [];
for (const s of suitesToRun) {
	console.log(`── ${s} ${'─'.repeat(Math.max(4, 55 - s.length))}`);
	const r = spawnSync('node', [`e2e/${s}.mjs`], { stdio: 'inherit', env: process.env });
	const ok = r.status === 0;
	summary.push({ s, ok, status: r.status });
	console.log(`   → ${ok ? 'PASS' : `FAIL (exit ${r.status})`}\n`);
}

const failed = summary.filter((x) => !x.ok);
console.log('══ 结果汇总 ' + '═'.repeat(50));
for (const { s, ok, status } of summary) {
	console.log(`  ${ok ? '✓' : '✗'} ${s}${ok ? '' : ` (exit ${status})`}`);
}
console.log(`\n测试通过率: ${summary.length - failed.length}/${summary.length}`);
process.exit(failed.length ? 1 : 0);
