// e2e: 音色库（检索 / 试听 / 选用）契约。
//
// 零真实 API：宿主的两条音色路由（/live2d-voice/voices*、/live2d-voice/voice-preview）
// 全部由 page.route 拦截回放夹具，所以本套件不依赖 Fish 配额与网络。
//
// 覆盖的用户路径：系统设置 → 「Live2D 角色与语音」→ 音色行 → 打开音色库 →
// 关键词搜索带上游 q= → 语言筛选带 language= → 试听发出预览 POST →
// 选用把 32 位 voiceId 写回配置、浮层关闭、音色行显示新标题。
import { launch, E2E_URL } from './lib/boot.mjs';

const FIXTURE_ID = '0123456789abcdef0123456789abcdef';
const FIXTURE_ENTRY = {
	id: FIXTURE_ID,
	title: '雷姆（夹具）',
	description: 'fixture voice for the voice library e2e',
	languages: ['ja'],
	tags: ['anime', 'female'],
	likes: 1234,
	cover: '',
};

/** 一小段静音 WAV：预览接口回放用，够 new Audio() 解码。 */
function wavFixture(seconds = 0.15, rate = 8000) {
	const data = Buffer.alloc(Math.floor(seconds * rate) * 2);
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

const checks = [];
const check = (name, ok, detail = '') => {
	checks.push({ name, ok });
	console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 200)));

const listQueries = [];
let previewHits = 0;
await page.route('**/live2d-voice/voices**', async (route) => {
	const url = new URL(route.request().url());
	// 单条解析（/voices/<id>）回单条，列表（/voices?…）回一页夹具
	const rest = url.pathname.replace('/live2d-voice/voices', '').replace(/^\/+/, '');
	if (rest) return route.fulfill({ json: { entry: { ...FIXTURE_ENTRY, id: rest } } });
	listQueries.push(url.search);
	return route.fulfill({ json: { entries: [FIXTURE_ENTRY], total: 1, page: 1, hasMore: false } });
});
await page.route('**/live2d-voice/voice-preview', async (route) => {
	previewHits += 1;
	await route.fulfill({ status: 200, contentType: 'audio/wav', body: wavFixture() });
});

const configPosts = [];
// 配置写入在本地拦截回放：断言的是"选用的 voiceId 进了 POST 体"，而不是真去改 e2e home
// 的配置文件——写进去会留下一个上游解析不到的 fixture 音色，污染后续套件。
let configTemplate = null;
await page.route('**/live2d-voice/config**', async (route) => {
	const request = route.request();
	if (request.method() === 'GET') {
		const response = await route.fetch();
		configTemplate = await response.json();
		return route.fulfill({ response });
	}
	configPosts.push(request.postData() ?? '');
	const patch = JSON.parse(request.postData() ?? '{}');
	const config = { ...(configTemplate?.config ?? {}), ...patch };
	return route.fulfill({ json: { config } });
});

await page.goto(E2E_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

/** 全新 e2e home 首启会有 Preview Notice / API key 等引导弹窗，拦截真实点击。 */
async function dismissOnboarding() {
	// dsh-web-app 首启的 onboarding：英文界面下是 "Configure later"（API key 引导）/ "Continue"
	const dismiss = ['Configure later', 'Continue', 'Got it', '知道了', '继续', 'Skip', '跳过', '稍后配置'];
	for (let i = 0; i < 5; i += 1) {
		const clicked = await page.evaluate((labels) => {
			const buttons = [...document.querySelectorAll('[role="dialog"] button, dialog button')];
			const hit = buttons.find((b) => labels.includes((b.textContent ?? '').trim()));
			if (!hit) return false;
			hit.click();
			return true;
		}, dismiss);
		if (!clicked) return;
		await page.waitForTimeout(500);
	}
}

/** 点一个按钮：轮询等它出现再点，不用固定 sleep（面板异步渲染，冷实例会假红）。 */
async function clickWhenReady(label, timeout = 20000) {
	await page.waitForFunction(
		(text) => [...document.querySelectorAll('button, a')].some((e) => (e.textContent ?? '').includes(text)),
		label,
		{ timeout },
	);
	await page.evaluate((text) => {
		const el = [...document.querySelectorAll('button, a')].find((e) => (e.textContent ?? '').includes(text));
		el?.click();
	}, label);
}

await dismissOnboarding();

// 系统设置 → Live2D 角色与语音（与 verify-settings-model 同一入口）。
// 导航格标题是「Live2D 角色与语音」——用「角色与语音」后缀匹配，别误点会话视图的 Live2D 标签。
await clickWhenReady('Settings');
await dismissOnboarding();
await clickWhenReady('角色与语音');
// 设置卡在配置加载完成前渲染的是 loading 态，等音色行出现再断言
const rowAppeared = await page
	.waitForSelector('.lv-voice-current', { timeout: 15000 })
	.then(() => true)
	.catch(() => false);
if (!rowAppeared) {
	console.log('✗ V0 设置页未渲染音色行（Live2D 设置分组没打开 / 配置未加载）');
	await browser.close();
	process.exit(1);
}
check(
	'V1 音色行渲染（旧预设下拉已被替换）',
	(await page.locator('.lv-voice-picker select').count()) === 0,
	'音色控件里不再有 preset <select>',
);

// ── 打开音色库 ────────────────────────────────────────────────────────────
await page.locator('.lv-voice-current').first().click();
await page.waitForSelector('.lv-vlib', { timeout: 8000 });
check('V2 音色库浮层打开', true);

const portaled = await page.evaluate(() => document.querySelector('.lv-vlib-mask')?.parentElement === document.body);
check('V3 浮层 portal 到 body（舞台 transform 劫持不到 fixed）', portaled);

check('V4 首次查询无筛选参数', listQueries.length >= 1 && listQueries[0] === '', JSON.stringify(listQueries[0] ?? ''));
const firstTitle = await page.locator('.lv-vlib-title').first().textContent();
check('V5 夹具音色渲染成行', (firstTitle ?? '').includes('雷姆'), firstTitle ?? '');
const meta = await page.locator('.lv-vlib-meta').first().textContent();
check('V6 行内展示语言与热度', (meta ?? '').includes('日语') && (meta ?? '').includes('1234'), meta ?? '');

// ── 检索与筛选 ────────────────────────────────────────────────────────────
await page.fill('.lv-vlib-search', 'rem');
await page.waitForTimeout(900);
check('V7 关键词走上游 q=', listQueries.some((q) => q.includes('q=rem')), JSON.stringify(listQueries.at(-1) ?? ''));

await page.locator('.lv-vlib-chip', { hasText: '日语' }).click();
await page.waitForTimeout(700);
check('V8 语言筛选走上游 language=', (listQueries.at(-1) ?? '').includes('language=ja'), JSON.stringify(listQueries.at(-1) ?? ''));

await page.locator('.lv-vlib-chip', { hasText: '动漫' }).click();
await page.waitForTimeout(700);
check('V9 标签筛选走上游 tag=', (listQueries.at(-1) ?? '').includes('tag=anime'), JSON.stringify(listQueries.at(-1) ?? ''));

// ── 试听 ──────────────────────────────────────────────────────────────────
await page.locator('.lv-vlib-row .lv-vlib-btn').first().click();
await page.waitForTimeout(1500);
check('V10 试听触发预览 POST', previewHits >= 1, `hits=${previewHits}`);

// ── 选用 ──────────────────────────────────────────────────────────────────
await page.locator('.lv-vlib-btn.lv-primary').first().click();
await page.waitForTimeout(1200);
check('V11 选用的 voiceId 写回配置', configPosts.some((body) => body.includes(FIXTURE_ID)), (configPosts.at(-1) ?? '').slice(0, 120));
check('V12 选用后浮层关闭', (await page.locator('.lv-vlib').count()) === 0);
const label = await page.locator('.lv-voice-current .lv-voice-name').first().textContent();
check('V13 音色行显示新音色标题而非短 id', (label ?? '').includes('雷姆'), label ?? '');

// ── 窄屏与关闭路径 ────────────────────────────────────────────────────────
await page.setViewportSize({ width: 420, height: 860 });
await page.waitForTimeout(400);
await page.locator('.lv-voice-current').first().click();
await page.waitForSelector('.lv-vlib', { timeout: 8000 });
const box = await page.locator('.lv-vlib').boundingBox();
check('V14 窄屏音色库铺满视口', Boolean(box && box.width >= 419 && box.height >= 859), JSON.stringify(box));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('V15 Esc 关闭浮层', (await page.locator('.lv-vlib').count()) === 0);
check('V16 关闭浮层不改配置', configPosts.length === 1, `config POSTs=${configPosts.length}`);

check('V17 无未捕获页面异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
