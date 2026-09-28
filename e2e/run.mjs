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
import { spawnSync } from 'node:child_process';

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
		description: '视线追踪、数学计算与调节滑块',
		suites: ['verify-look-math', 'verify-look-sliders'],
	},
	settings: {
		description: '设置面板、模型与音色选项切换',
		suites: ['verify-settings-model'],
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
