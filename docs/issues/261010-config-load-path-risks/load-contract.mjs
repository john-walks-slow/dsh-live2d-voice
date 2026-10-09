// 线上配置读写路径契约探针（DSH_HOME 指向临时目录，绝不碰线上配置）
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig, configFilePath } from '/root/projects/dsh-live-mode/src/config.ts';

const HOME = process.env.DSH_HOME;
const FILE = configFilePath();
const write = (obj) => writeFileSync(FILE, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
const line = (s) => console.log(s);
const keys = (o) => Object.keys(o).length;

line(`临时 home: ${HOME}（配置文件 ${FILE}）`);
rmSync(FILE, { force: true });

// ① torn JSON → 全默认，且随后一次 save 会把"全默认"落盘
write('{ "modelSelection": "hiyori", "touchMode": tr');
try { JSON.parse(readFileSync(FILE, 'utf8')); } catch { line('① 写坏的 JSON 确实无法解析'); }
const afterTorn = loadConfig();
line(`① ①a loadConfig 未抛异常，返回 modelSelection=${JSON.stringify(afterTorn.modelSelection)} touchMode=${afterTorn.touchMode} 字段数=${keys(afterTorn)}`);
saveConfig({ sentenceSubtitles: afterTorn.sentenceSubtitles });
const persisted = JSON.parse(readFileSync(FILE, 'utf8'));
line(`① ①b 随后一次 save 落盘：modelSelection=${JSON.stringify(persisted.modelSelection)}（原值已被默认值顶替）`);

// ② apiKeys 数组里的垃圾元素
write({ apiKeys: ['k1', null, '', 123, 'k2', {}] });
line(`② apiKeys ['k1',null,'',123,'k2',{}] → ${JSON.stringify(loadConfig().apiKeys)}`);

// ③ 未显式处理的键：原样透传，连类型都不校验
write({ modelSelection: 123, voiceId: { weird: true }, speechPrompt: '  keep  ' });
const pass = loadConfig();
line(`③ 透传 modelSelection=${JSON.stringify(pass.modelSelection)} voiceId=${JSON.stringify(pass.voiceId)} speechPrompt=${JSON.stringify(pass.speechPrompt)}`);

// ④ 显式处理的 4 个键：类型不对就回落默认
write({ idleInterval: '20', touchMode: 'yes', workspaces: [1, 2], apiKeys: 'not-an-array' });
const coerced = loadConfig();
line(`④ idleInterval:"20"→${JSON.stringify(coerced.idleInterval)} touchMode:"yes"→${coerced.touchMode} workspaces:[1,2]→${JSON.stringify(coerced.workspaces)} apiKeys:"..."→${JSON.stringify(coerced.apiKeys)}`);

// ⑤ 两条静默迁移
write({ sttLanguage: 'zh', thirdPerson: true });
const migrated = loadConfig();
line(`⑤ sttLanguage:"zh"（无 speechLanguage）→${JSON.stringify(migrated.sttLanguage)}；thirdPerson:true（无 liveMode）→liveMode=${JSON.stringify(migrated.liveMode)}，载入对象里 thirdPerson 存在? ${'thirdPerson' in migrated}`);
saveConfig({ touchMode: false });
line(`⑤ 迁移后一次 save 落盘：liveMode=${JSON.stringify(JSON.parse(readFileSync(FILE, 'utf8')).liveMode)}，文件里 thirdPerson 存在? ${'thirdPerson' in JSON.parse(readFileSync(FILE, 'utf8'))}`);
