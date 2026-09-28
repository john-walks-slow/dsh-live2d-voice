// src/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
var VOICE_PRESETS = [
  { id: "rem", label: "\u6E29\u67D4\u5973\u4EC6 \xB7 \u96F7\u59C6", voiceId: "0c7771ca5910484e8a4933068017fcee", lang: "ja" },
  { id: "maid", label: "\u5143\u6C14\u5973\u4EC6", voiceId: "abf4fa2e25634b41aadc4e0ef9ddaea5", lang: "ja" },
  { id: "frieren", label: "\u77E5\u6027\u5973\u58F0 \xB7 \u8299\u8389\u83B2", voiceId: "c174516c799a42e7be88b96c86cfbd3e", lang: "ja" },
  { id: "furina", label: "\u5A07\u4FCF\u5973\u58F0 \xB7 \u8299\u5B81\u5A1C", voiceId: "3fd70bbcdb6342df8c0c4143b958944b", lang: "ja" },
  { id: "cute", label: "\u751C\u7F8E\u5C11\u5973\u97F3", voiceId: "0c54c26032024142bf6339dc4d4aca1b", lang: "ja" },
  // ── 2026-09-24 第二批：Fish Audio 公共音色库实测收录（20 个，均合成验证通过）──
  // 动漫角色 / 二次元声线
  { id: "anime-girl", label: "\u6807\u51C6\u52A8\u6F2B\u5C11\u5973\u97F3", voiceId: "73647cd4ff7c477cb787d5fd8068f3e8", lang: "ja" },
  { id: "ram", label: "\u50B2\u5A07\u5973\u58F0 \xB7 \u62C9\u59C6", voiceId: "deb7b4e20b7048b19f96b646bfaa4549", lang: "ja" },
  { id: "teio", label: "\u5143\u6C14\u5C11\u5973 \xB7 \u4E1C\u6D77\u5E1D\u738B", voiceId: "44b6e5eeab214296bcfd73e767225229", lang: "ja" },
  { id: "alya", label: "\u6E05\u51B7\u7F8E\u5C11\u5973 \xB7 \u827E\u8389\u96C5", voiceId: "15b8bae03d344eafaa53f174fb13cf32", lang: "ja" },
  { id: "teto", label: "\u7535\u97F3\u6B4C\u59EC \xB7 \u91CD\u97F3 Teto", voiceId: "852c5b1d1cd24657bf2865152e67bb3e", lang: "ja" },
  { id: "misuzu", label: "\u6CBB\u6108\u5973\u58F0 \xB7 \u795E\u5C3E\u89C2\u94C3", voiceId: "20967b3d497045b78e992924f2f05488", lang: "ja" },
  { id: "fubuki", label: "\u72D0\u8033\u5A18 \xB7 \u767D\u4E0A\u5439\u96EA", voiceId: "5e6675f7a3984e30b2413f81deb677f6", lang: "ja" },
  { id: "hatsuki", label: "\u8F6F\u840C\u5E7C\u5973 \xB7 \u5C9B\u7530\u53F6\u6708", voiceId: "e9377327f5fb4690842604f8455048f5", lang: "ja" },
  { id: "rino", label: "\u673A\u68B0\u59B9\u97F3 \xB7 \u673A\u5668\u4EBA\u91CC\u8BFA", voiceId: "91e378d7b6574841ad5c4f915afdc8b9", lang: "ja" },
  // 通用声线类型
  { id: "genki-woman", label: "\u5143\u6C14\u5973\u58F0\uFF08\u901A\u7528\uFF09", voiceId: "5161d41404314212af1254556477c17d", lang: "zh" },
  { id: "calm-woman", label: "\u6C89\u7A33\u5973\u58F0\uFF08\u901A\u7528\uFF09", voiceId: "0089dce5fefb4c6ba9b9f2f0debe1ddc", lang: "zh" },
  { id: "narration-woman", label: "\u77E5\u6027\u65C1\u767D\u5973\u58F0", voiceId: "825c9e9870494118ad93b6853a22d5e7", lang: "zh" },
  { id: "genki-maid", label: "\u840C\u7CFB\u5973\u4EC6\u97F3", voiceId: "6c777b9c8eee4cd7862e1b073f6c42ec", lang: "zh" },
  { id: "tsundere-girl", label: "\u50B2\u5A07\u5C11\u5973\u97F3\uFF08\u901A\u7528\uFF09", voiceId: "4c415bf6872a4700adbda9a2d8b02fbb", lang: "ja" },
  { id: "genki-boy", label: "\u5143\u6C14\u5C11\u5E74\u97F3", voiceId: "ed3a1c523b524870a85a5a76cb1e0c3d", lang: "zh" },
  // 中文音色
  { id: "paimon", label: "\u5C0F\u98DE\u6BEF \xB7 \u6D3E\u8499\uFF08\u539F\u795E\uFF09", voiceId: "efc1ce3726a64bbc947d53a1465204aa", lang: "zh" },
  { id: "klee", label: "\u841D\u8389\u97F3 \xB7 \u53EF\u8389\uFF08\u539F\u795E\uFF09", voiceId: "0b8449eb752c4f888f463fc5d2c0db65", lang: "zh" },
  { id: "loli-zh", label: "\u841D\u8389\u97F3\uFF08\u4E2D\u6587\u901A\u7528\uFF09", voiceId: "f82e3885ac22468eb6c773b96f2c5752", lang: "zh" },
  // 英语 / VTuber
  { id: "filian", label: "\u82F1\u8BED VTuber \xB7 Filian", voiceId: "39d029582e9743e29f7c9e31fc3149e7", lang: "en" },
  { id: "neuro-sama", label: "AI \u58F0 \xB7 Neuro-sama", voiceId: "b2b2d0fa88ee44d789da28ebbd97421e", lang: "en" }
];
var VOICE_LANGUAGES = [
  { id: "all", label: "\u5168\u90E8\u8BED\u8A00" },
  { id: "zh", label: "\u4E2D\u6587" },
  { id: "ja", label: "\u65E5\u672C\u8A9E" },
  { id: "en", label: "English" }
];
var LANGUAGE_OPTIONS = [
  { id: "auto", label: "\u81EA\u52A8" },
  { id: "ja", label: "\u65E5\u672C\u8A9E" },
  { id: "zh", label: "\u4E2D\u6587" },
  { id: "en", label: "English" }
];
function languageLabel(language) {
  const map = { zh: "\u7B80\u4F53\u4E2D\u6587", ja: "\u65E5\u8BED", en: "English", ko: "\uD55C\uAD6D\uC5B4" };
  return map[language] ?? language;
}
function speechLanguageInstruction(language, subtitleLanguage = "zh") {
  const subtitleOn = subtitleLanguage !== "off" && subtitleLanguage !== language;
  if (language === "ja") {
    return subtitleOn ? "\u65E0\u8BBA\u7528\u6237\u4F7F\u7528\u4EC0\u4E48\u8BED\u8A00\uFF0C\u4F60\u90FD\u59CB\u7EC8\u7528\u65E5\u8BED\u81EA\u7136\u4EA4\u6D41\uFF08\u7528\u6237\u4F1A\u770B\u5230\u5B57\u5E55\u7FFB\u8BD1\uFF09\u3002" : "\u65E0\u8BBA\u7528\u6237\u4F7F\u7528\u4EC0\u4E48\u8BED\u8A00\uFF0C\u4F60\u90FD\u59CB\u7EC8\u7528\u65E5\u8BED\u81EA\u7136\u4EA4\u6D41\u3002";
  }
  const map = {
    zh: "\u65E0\u8BBA\u7528\u6237\u4F7F\u7528\u4EC0\u4E48\u8BED\u8A00\uFF0C\u4F60\u90FD\u59CB\u7EC8\u7528\u4E2D\u6587\u81EA\u7136\u4EA4\u6D41\u3002",
    en: "Whatever language the user speaks, always reply naturally in English."
  };
  return map[language] ?? "";
}
var DEFAULT_EMOTION_MAP = {
  neutral: 0,
  joy: 1,
  sappiness: 1,
  sadness: 2,
  anger: 3,
  surprise: 4,
  fear: 5,
  disgust: 6,
  shy: 7
};
var DEFAULT_CONFIG = {
  modelPath: "",
  modelSelection: "",
  voiceId: VOICE_PRESETS[0].voiceId,
  ttsModel: "s2.1-pro-free",
  apiKeys: [],
  apiKeyFile: "",
  sttLanguage: "auto",
  asrMode: "stream",
  micGain: 1.5,
  micNoiseSuppression: true,
  asrCredentialsFile: join(homedir(), ".config/volc-asr/credentials.json"),
  speechLanguage: "ja",
  subtitleLanguage: "zh",
  sentenceSubtitles: true,
  speechPrompt: "",
  idleInterval: 20,
  eyeTracking: false,
  gyroParallax: false,
  emotionMap: { ...DEFAULT_EMOTION_MAP },
  liveMode: "first",
  playerModelSelection: "",
  playerVoiceId: "ed3a1c523b524870a85a5a76cb1e0c3d",
  playerPolish: true,
  playerSpeechLanguage: "zh",
  playerPrompt: "",
  playerEmotionMap: { ...DEFAULT_EMOTION_MAP },
  workspaces: {},
  liveModel: null,
  translateModel: null,
  polishModel: null
};
function configFilePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "live2d-voice.json");
}
function loadConfig() {
  try {
    if (!existsSync(configFilePath())) return structuredClone(DEFAULT_CONFIG);
    const raw = JSON.parse(readFileSync(configFilePath(), "utf-8"));
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      ...raw,
      emotionMap: { ...DEFAULT_EMOTION_MAP, ...raw.emotionMap ?? {} },
      playerEmotionMap: { ...DEFAULT_EMOTION_MAP, ...raw.playerEmotionMap ?? {} },
      idleInterval: typeof raw.idleInterval === "number" ? raw.idleInterval : DEFAULT_CONFIG.idleInterval,
      workspaces: raw.workspaces ?? {},
      apiKeys: Array.isArray(raw.apiKeys) ? raw.apiKeys.filter((k) => typeof k === "string" && k) : []
    };
    if (raw.speechLanguage === void 0 && config.sttLanguage === "zh") {
      config.sttLanguage = "auto";
    }
    if (raw.liveMode === void 0 && raw.thirdPerson === true) {
      config.liveMode = "third";
    }
    delete config.thirdPerson;
    return config;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}
function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  const dir = join(configFilePath(), "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configFilePath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
function resolveApiKeys(config) {
  if (config.apiKeys.length > 0) return [...config.apiKeys];
  if (config.apiKeyFile) {
    try {
      if (!existsSync(config.apiKeyFile)) return [];
      const text = readFileSync(config.apiKeyFile, "utf-8").trim();
      if (text.startsWith("[")) {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string" && k) : [];
      }
      return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}
var MODEL_LABELS = {
  chitose: "\u5343\u5C81 \xB7 \u7537\u6027\u89D2\u8272",
  "deepseek-chan": "DeepSeek\u5A18 \xB7 \u54C1\u724C\u62DF\u4EBA",
  epsilon: "\u4F0A\u666E\u897F\u9686 \xB7 \u6807\u51C6\u7248",
  "epsilon-lite": "\u4F0A\u666E\u897F\u9686 \xB7 \u7B80\u6613\u7248",
  gantzert: "\u5251\u58EB\u4E0E\u98DE\u9F99 \xB7 Gantzert",
  haru: "\u6625 \xB7 \u524D\u53F0\u63A5\u5F85\u7248",
  "haru-classic": "\u6625 \xB7 \u7ECF\u5178\u7248",
  haruto: "\u6625\u7FD4 \xB7 SD \u7537\u5B69",
  hibiki: "\u54CD \xB7 \u5143\u6C14\u5C11\u5973",
  hijiki: "\u7F8A\u6816\u83DC \xB7 \u9ED1\u732B\u5409\u7965\u7269",
  hiyori: "\u6843\u6FD1\u65E5\u548C \xB7 \u5143\u6C14\u5C11\u5973",
  izumi: "\u6CC9 \xB7 \u56DB\u79CD\u753B\u98CE",
  kei: "\u4EAC \xB7 \u5507\u5F62\u52A8\u6001\u7248",
  "kei-lite": "\u4EAC \xB7 \u7B80\u6613\u7248",
  koharu: "\u5C0F\u6625 \xB7 SD \u5973\u5B69",
  mao: "\u8679\u8272Mao \xB7 \u5143\u6C14\u5C11\u5973",
  mark: "\u9A6C\u514B\u541B \xB7 \u5C11\u5E74",
  miara: "\u7C73\u4E9A\u62C9 \xB7 \u5168\u8EAB\u5C11\u5973",
  miku: "\u521D\u97F3\u672A\u6765",
  "miku-pro": "\u521D\u97F3\u672A\u6765 \xB7 \u589E\u5F3A\u7248",
  natori: "\u540D\u6267\u5C3D \xB7 \u6210\u5E74\u7537\u6027",
  "ni-j": "\u59AE\u6258 \xB7 \u6362\u88C5\u306B\u3058",
  nico: "\u59AE\u6258 \xB7 \u6362\u88C5\u306B\u3053",
  nietzsche: "\u59AE\u6258 \xB7 \u6362\u88C5\u306B\u3061\u3047",
  nipsilon: "\u59AE\u6258 \xB7 \u6362\u88C5\u306B\u3077\u3057\u308D\u3093",
  nito: "\u59AE\u6258 \xB7 \u4E8C\u5934\u8EAB",
  rice: "\u83B1\u65AF \xB7 \u5154\u5B50\u5409\u7965\u7269",
  shizuku: "\u96EB \xB7 \u5973\u5B50\u9AD8\u4E2D\u751F",
  simple: "\u7B80\u5355\u6A21\u578B \xB7 \u65B0\u624B\u5411",
  tororo: "\u5C71\u836F\u6CE5 \xB7 \u767D\u732B\u5409\u7965\u7269",
  tsumiki: "\u6625\u4F1E \xB7 \u5408\u4F5C\u5C11\u5973",
  unitychan: "Unity\u9171",
  wanko: "\u7897\u4E2D\u5C0F\u5E74\u7CD5 \xB7 \u72AC\u7CFB\u5409\u7965\u7269",
  zundamon: "\u4FCA\u8FBE\u840C \xB7 \u8C46\u7C89\u5409\u7965\u7269",
  // moc2 老格式（Cubism 2.1，食物语拆包重制 settings）
  fotiaoqiang: "\u4F5B\u8DF3\u5899 \xB7 \u95FD\u83DC\u62DF\u4EBA\uFF08\u65E7\u7248\uFF09",
  qingtuan: "\u9752\u56E2 \xB7 \u70B9\u5FC3\u62DF\u4EBA\uFF08\u65E7\u7248\uFF09",
  sixiwangzi: "\u56DB\u559C\u4E38\u5B50 \xB7 \u9C81\u83DC\u62DF\u4EBA\uFF08\u65E7\u7248\uFF09",
  lonjingxiaren: "\u9F99\u4E95\u867E\u4EC1 \xB7 \u6D59\u83DC\u62DF\u4EBA\uFF08\u65E7\u7248\uFF09",
  jiaozi: "\u997A\u5B50 \xB7 \u9762\u70B9\u62DF\u4EBA\uFF08\u65E7\u7248\uFF09",
  zongzi: "\u7CBD\u5B50 \xB7 \u7AEF\u5348\u62DF\u4EBA\uFF08\u65E7\u7248\uFF09",
  // 游戏拆包 · 少女前线（moc3 normal 形态，仅个人学习）
  hk416: "HK416 \xB7 \u6218\u672F\u5C11\u5973",
  m4a1: "M4A1 \xB7 \u6218\u672F\u5C11\u5973",
  ar15: "AR-15 \xB7 \u6218\u672F\u5C11\u5973",
  sopmod2: "SOPMOD II \xB7 \u6218\u672F\u5C11\u5973",
  type95: "95\u5F0F \xB7 \u6218\u672F\u5C11\u5973",
  vector: "Vector \xB7 \u6218\u672F\u5C11\u5973",
  wa2000: "WA2000 \xB7 \u6218\u672F\u5C11\u5973",
  g11: "G11 \xB7 \u6218\u672F\u5C11\u5973",
  g36: "G36 \xB7 \u6218\u672F\u5C11\u5973",
  m16a1: "M16A1 \xB7 \u6218\u672F\u5C11\u5973",
  ump45: "UMP45 \xB7 \u6218\u672F\u5C11\u5973",
  g41: "G41 \xB7 \u6218\u672F\u5C11\u5973",
  // 游戏拆包 · 素晴日 Fantastic Days（moc3，仅个人学习）
  aqua: "\u963F\u5E93\u5A05 \xB7 \u6C34\u4E4B\u5973\u795E",
  "aqua-priest": "\u963F\u5E93\u5A05 \xB7 \u796D\u53F8\u88C5",
  megumin: "\u60E0\u60E0 \xB7 \u7206\u88C2\u9B54\u6CD5\u4F7F",
  "megumin-cape": "\u60E0\u60E0 \xB7 \u62AB\u98CE\u88C5",
  darkness: "\u8FBE\u514B\u59AE\u4E1D \xB7 \u5341\u5B57\u9A91\u58EB",
  "darkness-armor": "\u8FBE\u514B\u59AE\u4E1D \xB7 \u9A91\u58EB\u88C5\u7532",
  wiz: "\u7EF4\u5179 \xB7 \u9B54\u9053\u5177\u5E97\u957F",
  yunyun: "\u60A0\u60A0 \xB7 \u7EA2\u9B54\u65CF",
  "yunyun-casual": "\u60A0\u60A0 \xB7 \u4FBF\u670D",
  eris: "\u5384\u91CC\u65AF \xB7 \u5E78\u8FD0\u5973\u795E",
  chris: "\u514B\u91CC\u65AF \xB7 \u76D7\u8D3C",
  // 游戏拆包 · 碧蓝航线（moc3，仅个人学习）
  enterprise: "\u4F01\u4E1A \xB7 \u78A7\u84DD\u822A\u7EBF",
  belfast: "\u8D1D\u5C14\u6CD5\u65AF\u7279 \xB7 \u78A7\u84DD\u822A\u7EBF",
  laffey: "\u62C9\u83F2 \xB7 \u78A7\u84DD\u822A\u7EBF",
  ayanami: "\u7EEB\u6CE2 \xB7 \u78A7\u84DD\u822A\u7EBF",
  taihou: "\u5927\u51E4 \xB7 \u78A7\u84DD\u822A\u7EBF",
  atago: "\u7231\u5B95 \xB7 \u78A7\u84DD\u822A\u7EBF",
  takao: "\u9AD8\u96C4 \xB7 \u78A7\u84DD\u822A\u7EBF",
  bismarck: "\u4FFE\u65AF\u9EA6 \xB7 \u78A7\u84DD\u822A\u7EBF",
  eugen: "\u6B27\u6839\u4EB2\u738B \xB7 \u78A7\u84DD\u822A\u7EBF",
  zeppelin: "\u9F50\u67CF\u6797\u4F2F\u7235 \xB7 \u78A7\u84DD\u822A\u7EBF",
  unicorn: "\u72EC\u89D2\u517D \xB7 \u78A7\u84DD\u822A\u7EBF",
  shinano: "\u4FE1\u6D53 \xB7 \u78A7\u84DD\u822A\u7EBF"
};
var GROUP_LABELS = {
  official: "\u5B98\u65B9\u793A\u4F8B",
  brand: "\u54C1\u724C\u62DF\u4EBA",
  "game-ripped-food": "\u6E38\u620F\u62C6\u5305 \xB7 \u98DF\u7269\u8BED",
  "game-girls-frontline": "\u6E38\u620F\u62C6\u5305 \xB7 \u5C11\u5973\u524D\u7EBF",
  "game-fantastic-days": "\u6E38\u620F\u62C6\u5305 \xB7 \u7D20\u6674\u65E5",
  "game-azur-lane": "\u6E38\u620F\u62C6\u5305 \xB7 \u78A7\u84DD\u822A\u7EBF"
};
function findModelSettings(dirPath) {
  const entry = readdirSync(dirPath).find((file) => file.endsWith(".model3.json"));
  if (entry) return { file: entry, kind: "moc3" };
  for (const file of readdirSync(dirPath).filter((f) => /\.json$/i.test(f))) {
    try {
      const raw = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
      if (raw && raw.type === "Live2D Model Setting" && typeof raw.model === "string" && /\.moc$/i.test(raw.model)) {
        return { file, kind: "moc2" };
      }
    } catch {
    }
  }
  return null;
}
function resolveModelCatalog(config) {
  if (!config.modelPath) return [];
  const models = [];
  let rootEntries;
  try {
    rootEntries = readdirSync(config.modelPath);
  } catch {
    return [];
  }
  const direct = rootEntries.filter((file) => file.endsWith(".model3.json")).sort();
  if (direct.length > 0) {
    for (const entry of direct) {
      const name2 = entry.replace(/\.model3\.json$/, "");
      models.push({ name: name2, label: MODEL_LABELS[name2] ?? name2, relative: entry, kind: "moc3" });
    }
    return models;
  }
  for (const dir of rootEntries.slice().sort((a, b) => a.localeCompare(b))) {
    try {
      const dirPath = join(config.modelPath, dir);
      if (!statSync(dirPath).isDirectory()) continue;
      const own = findModelSettings(dirPath);
      if (own) {
        models.push({ name: dir, label: MODEL_LABELS[dir] ?? dir, relative: `${dir}/${own.file}`, kind: own.kind });
        continue;
      }
      for (const leaf of readdirSync(dirPath).sort((a, b) => a.localeCompare(b))) {
        try {
          const leafPath = join(dirPath, leaf);
          if (!statSync(leafPath).isDirectory()) continue;
          const found = findModelSettings(leafPath);
          if (found) {
            models.push({
              name: leaf,
              label: MODEL_LABELS[leaf] ?? leaf,
              relative: `${dir}/${leaf}/${found.file}`,
              kind: found.kind,
              group: dir
            });
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return models;
}
function resolveModelSelection(config, catalog) {
  if (catalog.length === 0) return void 0;
  return catalog.find((model) => model.name === config.modelSelection) ?? catalog[0];
}
function extractModelMotions(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    const motions = [];
    const seen = /* @__PURE__ */ new Set();
    const motionSection = raw?.FileReferences?.Motions || raw?.motions || {};
    for (const [group, list] of Object.entries(motionSection)) {
      if (!Array.isArray(list)) continue;
      list.forEach((item, index) => {
        const file = item?.File || item?.file || "";
        let base = file ? basename(file).replace(/\.(motion3|exp3|mtn)\.json$|\.mtn$/, "") : "";
        if (!base) {
          base = group ? `${group}_${index}` : `motion_${index}`;
        }
        let name2 = base;
        if (seen.has(name2)) {
          name2 = `${base}_${index}`;
        }
        seen.add(name2);
        motions.push({ name: name2, group, index });
      });
    }
    return motions;
  } catch {
    return [];
  }
}
function resolveSessionConfig(agents, config, sessionId) {
  if (!sessionId) return config;
  try {
    const agent = agents.get(sessionId);
    const cwd = agent?.session?.header?.cwd;
    if (!cwd) return config;
    const override = config.workspaces[cwd];
    if (!override) return config;
    return {
      ...config,
      ...override,
      emotionMap: { ...config.emotionMap, ...override.emotionMap ?? {} }
    };
  } catch {
    return config;
  }
}

// src/events.ts
var HEARTBEAT_MS = 15e3;
var SseHub = class {
  connections = /* @__PURE__ */ new Map();
  lastCloseListeners = /* @__PURE__ */ new Set();
  firstOpenListeners = /* @__PURE__ */ new Set();
  /**
   * Register a callback fired when a session's LAST connection closes —
   * the Live view is gone, so in-flight work for it should be aborted.
   */
  onLastClose(listener) {
    this.lastCloseListeners.add(listener);
    return () => this.lastCloseListeners.delete(listener);
  }
  /** Register a callback fired when a session's FIRST connection opens. */
  onFirstOpen(listener) {
    this.firstOpenListeners.add(listener);
    return () => this.firstOpenListeners.delete(listener);
  }
  /** Whether at least one Live view listens on this session (speech gate). */
  has(sessionId) {
    return (this.connections.get(sessionId)?.size ?? 0) > 0;
  }
  attach(sessionId, req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    let closed = false;
    const connection = {
      sessionId,
      send: (event, data) => {
        if (closed || res.writableEnded) return;
        res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
      },
      close: () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        const set2 = this.connections.get(sessionId);
        if (set2) {
          set2.delete(connection);
          if (set2.size === 0) {
            this.connections.delete(sessionId);
            for (const listener of this.lastCloseListeners) listener(sessionId);
          }
        }
        try {
          res.end();
        } catch {
        }
      }
    };
    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded) return;
      res.write(": keepalive\n\n");
    }, HEARTBEAT_MS);
    req.on("close", () => connection.close());
    res.on("close", () => connection.close());
    let set = this.connections.get(sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.connections.set(sessionId, set);
    }
    const wasEmpty = set.size === 0;
    set.add(connection);
    if (wasEmpty) for (const listener of this.firstOpenListeners) listener(sessionId);
    res.write(": connected\n\n");
    connection.send("hello", { sessionId });
    return connection;
  }
  emit(sessionId, event, data) {
    const set = this.connections.get(sessionId);
    if (!set) return;
    for (const connection of set) connection.send(event, data);
  }
};

// src/speech.ts
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm/brand";

// src/sentence.ts
var TERMINATOR = /[。！？!?…\n]/;
var PAUSES = ["\uFF0C", ",", "\u3001", "\uFF1B", ";", "\uFF1A", " ", ")", "\uFF09"];
function extractEmotionTags(text, vocabulary) {
  if (!text.includes("[")) return { clean: text, emotions: [] };
  const emotions = [];
  const clean = text.replace(/\[([a-zA-Z][a-zA-Z0-9_-]*)\]/g, (whole, tag) => {
    if (!vocabulary.has(tag)) return whole;
    emotions.push(tag);
    return "";
  });
  return { clean, emotions };
}
function extractMotionTags(text) {
  if (!text.includes("[motion:")) return { clean: text, motions: [] };
  const motions = [];
  const clean = text.replace(/\[motion:([a-zA-Z0-9_-]+)\]/gi, (_whole, tag) => {
    motions.push(tag);
    return "";
  });
  return { clean, motions };
}
var SentenceBuffer = class {
  constructor(softLimit = 120) {
    this.softLimit = softLimit;
  }
  softLimit;
  buffer = "";
  push(text) {
    this.buffer += text;
    const out = [];
    for (; ; ) {
      const sentence = this.cutOne();
      if (sentence === void 0) break;
      if (sentence.trim()) out.push(sentence);
    }
    return out;
  }
  /** Drain whatever remains (no terminator needed). */
  flush() {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() ? [rest] : [];
  }
  /** Remove and return the next complete sentence, or undefined if none yet. */
  cutOne() {
    const match = TERMINATOR.exec(this.buffer);
    if (match?.index !== void 0) {
      let end = match.index + 1;
      while (end < this.buffer.length && TERMINATOR.test(this.buffer[end])) end += 1;
      if (end < this.buffer.length && '\u300D\u300F\u201D"()\uFF09)'.includes(this.buffer[end])) end += 1;
      const sentence2 = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      return sentence2;
    }
    if (this.buffer.length < this.softLimit) return void 0;
    const half = Math.floor(this.softLimit / 2);
    let cutAt = -1;
    for (const pause of PAUSES) {
      const index = this.buffer.lastIndexOf(pause);
      if (index > Math.max(cutAt, half)) cutAt = index;
    }
    const take = cutAt > 0 ? cutAt + 1 : this.softLimit;
    const sentence = this.buffer.slice(0, take);
    this.buffer = this.buffer.slice(take);
    return sentence;
  }
};
var CUT_BOUNDARIES = "\u3002\uFF01\uFF1F!?\uFF0E.\uFF0C\u3001,;\uFF1B\uFF1A: \u2026\u2014 ";
function splitByWeight(translated, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || translated.length === 0) {
    const whole = new Array(n).fill("");
    whole[0] = translated;
    return whole;
  }
  const cuts = [0];
  for (let i = 1; i < n; i++) {
    const cumulative = weights.slice(0, i).reduce((a, b) => a + b, 0);
    const raw = Math.round(translated.length * cumulative / total);
    cuts.push(Math.min(translated.length, Math.max(cuts[i - 1] + 1, raw)));
  }
  cuts.push(translated.length);
  const snapped = cuts.slice();
  for (let i = 1; i < n; i++) {
    let best = snapped[i];
    let bestDist = Infinity;
    const lo = Math.max(snapped[i - 1] + 1, cuts[i] - 12);
    const hi = Math.min(snapped[i + 1] - 1, cuts[i] + 12);
    for (let pos = lo; pos <= hi; pos++) {
      if (CUT_BOUNDARIES.includes(translated[pos - 1] ?? "")) {
        const dist = Math.abs(pos - cuts[i]);
        if (dist < bestDist) {
          best = pos;
          bestDist = dist;
        }
      }
    }
    snapped[i] = best;
  }
  const pieces = [];
  for (let i = 0; i < n; i++) pieces.push(translated.slice(snapped[i], snapped[i + 1]).trim());
  return pieces;
}

// src/tts.ts
var FISH_TTS_URL = "https://api.fish.audio/v1/tts";
var PCM_SAMPLE_RATE = 44100;
var TtsError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
  status;
};
async function synthesize(options, onPcm) {
  if (options.apiKeys.length === 0) throw new TtsError("no Fish Audio API key configured", void 0);
  let lastError;
  for (const key of options.apiKeys) {
    try {
      await synthesizeWithKey(options, key, onPcm);
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof TtsError && (error.status === 401 || error.status === 402 || error.status === 429)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new TtsError("TTS failed", void 0);
}
async function synthesizeWithKey(options, key, onPcm) {
  const response = await fetch(FISH_TTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      model: options.model
    },
    body: JSON.stringify({
      text: options.text,
      reference_id: options.voiceId,
      format: "pcm",
      latency: "balanced"
    }),
    signal: options.signal
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new TtsError(`Fish TTS HTTP ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }
  const reader = response.body.getReader();
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) await onPcm(Buffer.from(value));
  }
}

// src/speech.ts
var TRANSLATE_TIMEOUT_MS = 2e4;
var TranslationQueue = class {
  tasks = [];
  running = false;
  push(task) {
    this.tasks.push(task);
    if (this.tasks.length > 2) this.tasks.shift();
    void this.drain();
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift();
        if (!task) continue;
        try {
          await task();
        } catch {
        }
      }
    } finally {
      this.running = false;
    }
  }
};
function applySpeechTap(ctx, deps) {
  const active = /* @__PURE__ */ new Map();
  const translations = /* @__PURE__ */ new Map();
  const translateOnce = async (sessionId, model, text, targetLanguage, signal) => {
    if (signal.aborted || !deps.hub.has(sessionId)) return "";
    const capped = new AbortController();
    const capTimer = setTimeout(() => capped.abort(), TRANSLATE_TIMEOUT_MS);
    const forwardAbort = () => capped.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    let translated = "";
    try {
      const stream = ctx.llm.stream({
        provider: model.provider,
        model: model.model,
        messages: [createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })],
        system: `You translate speech subtitles. Translate the user's text into ${languageLabel(targetLanguage)}. Reply with ONLY the translation \u2014 no notes, no quotes, no original text. If the text is already in the target language, reply with it unchanged. Keep it natural and concise.`,
        ...model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } : {},
        signal: capped.signal
      });
      for await (const chunk of stream) {
        if (capped.signal.aborted) return "";
        if (chunk.type === "text-delta" && chunk.text) translated += chunk.text;
      }
    } catch {
      return "";
    } finally {
      clearTimeout(capTimer);
      signal.removeEventListener("abort", forwardAbort);
    }
    const trimmed = translated.trim();
    return trimmed !== text ? trimmed : "";
  };
  ctx.on("llm/stream", (options, next) => {
    const sessionId = options.sessionId === void 0 ? "" : String(options.sessionId);
    if (!sessionId || options.purpose !== void 0) return next();
    if (!deps.hub.has(sessionId)) {
      if (!deps.modes.isExited(sessionId)) return next();
      const stream = next();
      return (async function* () {
        try {
          for await (const chunk of stream) yield chunk;
        } finally {
          deps.modes.clearExited(sessionId);
        }
      })();
    }
    const sessionConfig = deps.resolveSession(sessionId);
    const tm = sessionConfig.translateModel;
    const model = tm ? { provider: tm.provider, model: tm.model, ...tm.reasoningEffort ? { reasoningEffort: tm.reasoningEffort } : {} } : { provider: options.provider, model: options.model, ...typeof options.reasoningEffort === "string" && options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {} };
    return speak(deps, active, translations, translateOnce, sessionId, model, next());
  });
  deps.hub.onLastClose((sessionId) => {
    active.get(sessionId)?.abort.abort();
    translations.delete(sessionId);
  });
  return (sessionId) => {
    active.get(sessionId)?.abort.abort();
  };
}
async function* speak(deps, active, translations, translate, sessionId, model, chunks) {
  const config = deps.resolveSession(sessionId);
  const apiKeys = deps.resolveKeys(deps.getConfig());
  active.get(sessionId)?.abort.abort();
  const controller = new AbortController();
  const utteranceId = randomUUID().slice(0, 8);
  active.set(sessionId, { utteranceId, abort: controller });
  const buffer = new SentenceBuffer();
  const lines = [];
  let seq = 0;
  let lineSeq = 0;
  let queue = Promise.resolve();
  const sentenceMode = config.sentenceSubtitles !== false;
  const BLOCK_SENTENCES = 3;
  const BLOCK_CHARS = 140;
  const vocabulary = new Set(Object.keys(config.emotionMap));
  let blockLines = [];
  const enqueueUnit = (lineId, text) => {
    queue = queue.then(
      () => speakSentence(deps, sessionId, utteranceId, lineId, text, config, apiKeys, controller.signal, () => seq++)
    );
  };
  const flushBlock = () => {
    if (blockLines.length === 0) return;
    const text = blockLines.join("");
    blockLines = [];
    const lineId = `${utteranceId}-${++lineSeq}`;
    lines.push({ lineId, text });
    enqueueUnit(lineId, text);
  };
  const handleSentence = (raw) => {
    const { clean: cleanEmotion, emotions } = extractEmotionTags(raw, vocabulary);
    const { clean, motions } = extractMotionTags(cleanEmotion);
    const emotion = emotions.at(-1);
    if (emotion !== void 0) {
      deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression: config.emotionMap[emotion] });
    }
    for (const motion of motions) {
      deps.hub.emit(sessionId, "motion", { utteranceId, motion, speaker: "assistant" });
    }
    const text = clean.trim();
    if (!text) return;
    if (sentenceMode) {
      const lineId = `${utteranceId}-${++lineSeq}`;
      lines.push({ lineId, text });
      enqueueUnit(lineId, text);
      return;
    }
    blockLines.push(text);
    const chars = blockLines.reduce((n, line) => n + line.length, 0);
    if (blockLines.length >= BLOCK_SENTENCES || chars >= BLOCK_CHARS) flushBlock();
  };
  let settled = false;
  const settle = (reason) => {
    if (settled) return;
    settled = true;
    if (reason === "finish") deps.hub.emit(sessionId, "audio-end", { utteranceId });
    deps.hub.emit(sessionId, "speech-end", { utteranceId, reason });
    if (active.get(sessionId)?.utteranceId === utteranceId) active.delete(sessionId);
  };
  deps.hub.emit(sessionId, "speech-start", { utteranceId });
  deps.hub.emit(sessionId, "audio-start", { utteranceId, sampleRate: PCM_SAMPLE_RATE });
  if (apiKeys.length === 0) {
    deps.hub.emit(sessionId, "error", { message: "\u672A\u914D\u7F6E Fish Audio API key\uFF08live2d-voice.json \u2192 apiKeys \u6216 apiKeyFile\uFF09\uFF0C\u8BED\u97F3\u6717\u8BFB\u4E0D\u53EF\u7528" });
  }
  const drain = () => Promise.resolve(queue).then(() => settle(controller.signal.aborted ? "aborted" : "finish")).catch(() => settle("aborted"));
  try {
    for await (const chunk of chunks) {
      if (chunk.type === "text-delta" && chunk.text) {
        for (const sentence of buffer.push(chunk.text)) handleSentence(sentence);
      }
      yield chunk;
    }
    for (const sentence of buffer.flush()) handleSentence(sentence);
    if (!sentenceMode) flushBlock();
    const target = config.subtitleLanguage;
    if (target && target !== "off" && target !== config.speechLanguage && lines.length > 0 && deps.hub.has(sessionId)) {
      let tq = translations.get(sessionId);
      if (tq === void 0) {
        tq = new TranslationQueue();
        translations.set(sessionId, tq);
      }
      const snapshot = lines.slice();
      tq.push(() => translateWhole(deps, translate, sessionId, model, snapshot, target, controller.signal));
    }
    void drain();
  } catch (error) {
    controller.abort();
    queue.catch(() => void 0);
    void drain();
    throw error;
  }
}
async function speakSentence(deps, sessionId, utteranceId, lineId, text, config, apiKeys, signal, nextSeq) {
  let subtitled = false;
  const emitSubtitle = (audioSeq) => {
    if (subtitled) return;
    subtitled = true;
    deps.hub.emit(sessionId, "subtitle", { role: "assistant", text, utteranceId, lineId, audioSeq });
  };
  if (apiKeys.length === 0) {
    emitSubtitle();
    return;
  }
  try {
    await synthesize({ text, voiceId: config.voiceId, model: config.ttsModel, apiKeys, signal }, (pcm) => {
      const seq = nextSeq();
      emitSubtitle(seq);
      deps.hub.emit(sessionId, "audio", { utteranceId, seq, b64: pcm.toString("base64") });
    });
  } catch (error) {
    if (signal.aborted) return;
    deps.hub.emit(sessionId, "error", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    emitSubtitle();
  }
}
async function translateWhole(deps, translate, sessionId, model, lines, targetLanguage, signal) {
  const whole = lines.map((line) => line.text).join("");
  const translated = await translate(sessionId, model, whole, targetLanguage, signal);
  if (!translated) return;
  const perLine = splitByWeight(translated, lines.map((line) => line.text.length));
  for (let i = 0; i < lines.length; i++) {
    if (perLine[i]) {
      deps.hub.emit(sessionId, "subtitle-translation", { lineId: lines[i].lineId, text: perLine[i] });
    }
  }
}

// src/system-prompt.ts
import { join as join2 } from "node:path";
var SpeechModes = class {
  modes = /* @__PURE__ */ new Map();
  /** Resolve the mode for an assembly; updates state transitions. */
  transition(sessionId, isLive) {
    this.evictIfNeeded();
    if (isLive) {
      this.modes.set(sessionId, "live");
      return "live";
    }
    if (this.modes.get(sessionId) === "live") {
      this.modes.set(sessionId, "exited");
      return "exited";
    }
    return this.modes.get(sessionId);
  }
  isExited(sessionId) {
    return this.modes.get(sessionId) === "exited";
  }
  /** Drop the exit reminder (called after an unwatched turn completes). */
  clearExited(sessionId) {
    if (this.modes.get(sessionId) === "exited") this.modes.delete(sessionId);
  }
  /**
   * Bound the map: sessions deleted mid-live never return to clear their
   * entry, so past a soft cap drop every "exited" entry (they are
   * re-derivable) — live entries must survive as mode truth.
   */
  evictIfNeeded() {
    if (this.modes.size <= 256) return;
    for (const [sessionId, mode] of this.modes) {
      if (mode === "exited") this.modes.delete(sessionId);
    }
  }
};
function sessionKeyOf(agent) {
  if (!agent) return "";
  const session = agent.session;
  if (typeof session === "string") return session;
  if (session && typeof session === "object" && session.id !== void 0) return String(session.id);
  if (agent.id !== void 0) return String(agent.id);
  return "";
}
function liveSection(config) {
  const emotions = Object.keys(config.emotionMap);
  if (emotions.length === 0) return "";
  const lines = [
    "## Live2D \u8BED\u97F3\u6A21\u5F0F\uFF08\u5F53\u524D\u4F1A\u8BDD\uFF09",
    "\u4F60\u7684\u56DE\u590D\u6B63\u88AB\u5B9E\u65F6\u8F6C\u6210\u8BED\u97F3\u6717\u8BFB\u5E76\u9A71\u52A8\u4E00\u4E2A Live2D \u89D2\u8272\u8BF4\u8BDD\uFF0C\u8BF7\u9075\u5B88\uFF1A",
    "- \u7528\u53E3\u8BED\u5316\u3001\u81EA\u7136\u9002\u5408\u6717\u8BFB\u7684\u53E5\u5B50\uFF1B\u4E0D\u8981\u8F93\u51FA\u5217\u8868\u3001\u4EE3\u7801\u5757\u3001\u94FE\u63A5\u6216 Markdown \u7B26\u53F7\uFF1B\u4EE3\u7801\u4E0E\u547D\u4EE4\u6539\u7528\u7B80\u77ED\u53E3\u5934\u63CF\u8FF0\u3002",
    "- \u5728\u6BCF\u53E5\u6216\u6BCF\u4E2A\u8BED\u4E49\u6BB5\u7684\u5F00\u5934\u7528\u65B9\u62EC\u53F7\u60C5\u7EEA\u6807\u7B7E\u6807\u6CE8\u60C5\u7EEA\uFF0C\u53EA\u80FD\u4ECE\u8FD9\u4E9B\u6807\u7B7E\u91CC\u9009\uFF1A",
    `  ${emotions.map((emotion) => `[${emotion}]`).join(" ")}`,
    "- \u6807\u7B7E\u53EA\u7528\u4E8E\u63A7\u5236\u89D2\u8272\u8868\u60C5\uFF0C\u4E0D\u4F1A\u88AB\u6717\u8BFB\uFF1B\u6CA1\u6709\u60C5\u7EEA\u53D8\u5316\u65F6\u7701\u7565\u6807\u7B7E\u5373\u53EF\u3002"
  ];
  try {
    const catalog = resolveModelCatalog(config);
    const selection = resolveModelSelection(config, catalog);
    if (selection && config.modelPath) {
      const motions = extractModelMotions(join2(config.modelPath, selection.relative));
      if (motions.length > 0) {
        const uniqueNames = Array.from(new Set(motions.map((m) => m.name)));
        lines.push(
          "- \u4F60\u8FD8\u53EF\u4EE5\u63A7\u5236\u89D2\u8272\u7684\u8EAB\u4F53\u52A8\u4F5C\uFF0C\u5728\u9700\u8981\u8868\u8FBE\u52A8\u4F5C\u7684\u53E5\u5B50\u4E2D\u63D2\u5165\u52A8\u4F5C\u6807\u7B7E\uFF08\u6807\u7B7E\u53EA\u7528\u4E8E\u89E6\u53D1\u89D2\u8272\u52A8\u753B\uFF0C\u4E0D\u4F1A\u88AB\u6717\u8BFB\uFF0C\u9002\u5EA6\u4F7F\u7528\uFF09\uFF1A",
          `  ${uniqueNames.map((name2) => `[motion:${name2}]`).join(" ")}`
        );
      }
    }
  } catch {
  }
  if (config.liveMode === "third") {
    lines.push("- \u5F53\u524D\u4E3A\u7B2C\u4E09\u4EBA\u79F0\u6A21\u5F0F\uFF1A\u7528\u6237\u7684\u6D88\u606F\u7531\u5176\u89D2\u8272\u5316\u8EAB\u8BF4\u51FA\uFF08\u53EF\u80FD\u5DF2\u7ECF\u8FC7\u6DA6\u8272\u6216\u7FFB\u8BD1\uFF09\uFF0C\u8BF7\u628A\u5B83\u5F53\u4F5C\u89D2\u8272\u626E\u6F14\u4E2D\u5BF9\u65B9\u7684\u53F0\u8BCD\u6765\u56DE\u5E94\u3002");
  } else if (config.liveMode === "call") {
    lines.push("- \u5F53\u524D\u4E3A\u89C6\u9891\u901A\u8BDD\u6A21\u5F0F\uFF1A\u7528\u6237\u6B63\u5728\u548C\u4F60\u7684\u89D2\u8272\u89C6\u9891\u901A\u8BDD\uFF0C\u7528\u6237\u7684\u6D88\u606F\u5C31\u662F TA \u672C\u4EBA\u76F4\u63A5\u8BF4\u51FA\u7684\u8BDD\uFF1B\u56DE\u590D\u4F1A\u88AB\u6717\u8BFB\u5E76\u9A71\u52A8\u4F60\u7684\u89D2\u8272\u5F62\u8C61\uFF0C\u5C31\u50CF\u901A\u8BDD\u753B\u9762\u5BF9\u9762\u7684\u5BF9\u8BDD\u4E00\u6837\u3002");
  }
  const language = speechLanguageInstruction(config.speechLanguage, config.subtitleLanguage);
  if (language) lines.push(`- ${language}`);
  const custom = config.speechPrompt.trim();
  if (custom) lines.push("", "\u7528\u6237\u9644\u52A0\u8981\u6C42\uFF1A", custom);
  return lines.join("\n");
}
var EXIT_SECTION = [
  "## \u5DF2\u9000\u51FA Live2D \u8BED\u97F3\u6A21\u5F0F",
  "\u7528\u6237\u5DF2\u5207\u56DE\u666E\u901A\u6587\u5B57\u5BF9\u8BDD\uFF1A\u6B63\u5E38\u4F7F\u7528 Markdown\u3001\u5217\u8868\u4E0E\u4EE3\u7801\u5757\uFF1B\u4E0D\u8981\u518D\u8F93\u51FA\u65B9\u62EC\u53F7 [\u60C5\u7EEA] \u6807\u7B7E\uFF0C\u4E5F\u4E0D\u8981\u518D\u9075\u5B88\u8BED\u97F3\u6717\u8BFB\u7684\u683C\u5F0F\u9650\u5236\u3002"
].join("\n");
function createPluginMessage(text) {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: "dsh-live2d-voice",
      form: "instructions",
      summary: "Live2D \u8BED\u97F3\u6A21\u5F0F\u6307\u4EE4"
    }
  };
}
function applySpeechInjection(ctx, deps) {
  const disposers = /* @__PURE__ */ new Set();
  const install = (agent) => {
    if (!agent?.ctx || typeof agent.ctx.on !== "function") return;
    const stop = agent.ctx.on(
      "agent/pre-step",
      async (...args) => {
        const payload = args[0];
        const next = args[1];
        const decision = await next();
        if (decision.kind === "reject" || payload.signal?.aborted) return decision;
        if (payload.step !== 1) return decision;
        const messages = decision.messages;
        if (!Array.isArray(messages) || messages.length === 0) return decision;
        const sessionId = sessionKeyOf(agent);
        if (!sessionId) return decision;
        if (messages.some((m) => m?.source?.kind === "dsh-live2d-voice")) {
          return decision;
        }
        const config = deps.resolveSession(sessionId);
        if (!config.modelPath) return decision;
        const mode = deps.modes.transition(sessionId, deps.hub.has(sessionId));
        const text = mode === "live" ? liveSection(config) : mode === "exited" ? EXIT_SECTION : "";
        if (!text) return decision;
        ctx.logger.warn(`dsh-live2d-voice: pre-step inject for ${sessionId.slice(0, 8)}\u2026 (mode=${mode})`);
        return { kind: "enter", messages: [...messages, createPluginMessage(text)] };
      },
      { prepend: true }
    );
    disposers.add(() => stop());
    ctx.logger.warn(`dsh-live2d-voice: pre-step listener installed for agent ${String(agent.id ?? "").slice(0, 12) || "(root)"}`);
  };
  const onCreated = ctx.on;
  const stopCreated = onCreated("agent/created", (...args) => {
    const agent = args[0]?.agent;
    if (agent) install(agent);
  });
  for (const agent of ctx.agents?.roots?.() ?? []) install(agent);
  return () => {
    stopCreated();
    for (const dispose of disposers) dispose();
    disposers.clear();
  };
}

// src/context-slim.ts
import { join as join3 } from "node:path";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
var sessionKeyOf2 = (agent) => {
  const s = agent?.session;
  if (typeof s === "string") return s;
  return s?.id ?? void 0;
};
function prunePreStepMessages(messages) {
  if (!Array.isArray(messages)) return { kept: messages, removedBytes: 0, removedCount: 0 };
  let removedBytes = 0;
  let removedCount = 0;
  const kept = messages.filter((m) => {
    const text = typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("") : "";
    if (m?.source?.kind === "dsh-live2d-voice") return true;
    if (text.includes("<available_skills>")) {
      removedBytes += text.length;
      removedCount += 1;
      return false;
    }
    if (text.includes("This complete workspace instruction baseline replaces")) {
      removedBytes += text.length;
      removedCount += 1;
      return false;
    }
    return true;
  });
  return { kept, removedBytes, removedCount };
}
function applyContextSlim(ctx, deps) {
  const disposers = /* @__PURE__ */ new Set();
  const installAssemble = (agent) => {
    if (!agent?.ctx || typeof agent.ctx.on !== "function") return;
    const stop = agent.ctx.on(
      "system-prompt/assemble",
      async (...args) => {
        const assembly = args[0];
        const context = args[1];
        const next = args[2];
        const sessionId = sessionKeyOf2(agent);
        if (!sessionId) return next();
        const live = deps.hub.has(sessionId);
        if (!live) return next();
        const next_ = await next();
        const originalTools = next_.tools ?? [];
        const originalSections = next_.sections ?? [];
        const originalContexts = next_.contexts ?? [];
        const beforeBytes = JSON.stringify({
          tools: originalTools,
          sections: originalSections,
          contexts: originalContexts
        }).length;
        const strippedTools = [];
        const strippedContexts = originalContexts.filter((c) => {
          const text = typeof c?.text === "string" ? c.text : "";
          if (text.startsWith("Current runtime context:")) return false;
          return true;
        });
        const afterBytes = JSON.stringify({
          tools: strippedTools,
          sections: originalSections,
          contexts: strippedContexts
        }).length;
        const saved = beforeBytes - afterBytes;
        if (saved > 0) {
          ctx.logger.warn(
            `dsh-live2d-voice/context-slim: ${sessionId.slice(0, 8)}\u2026 live mode \u2192 stripped ${originalTools.length} tools, ${originalContexts.length - strippedContexts.length} contexts (${(saved / 1024).toFixed(1)} KB saved / ${(beforeBytes / 1024).toFixed(1)} KB \u2192 ${(afterBytes / 1024).toFixed(1)} KB)`
          );
        }
        return {
          ...next_,
          tools: strippedTools,
          contexts: strippedContexts
        };
      }
    );
    disposers.add(stop);
  };
  const install = (agent) => {
    installAssemble(agent);
    if (!agent?.ctx || typeof agent.ctx.on !== "function") return;
    const stop = agent.ctx.on(
      "agent/pre-step",
      async (...args) => {
        const payload = args[0];
        const next = args[1];
        const decision = await next();
        if (decision.kind === "reject" || payload.signal?.aborted) return decision;
        const sessionId = sessionKeyOf2(agent);
        if (!sessionId || !deps.hub.has(sessionId)) return decision;
        const { kept, removedBytes, removedCount } = prunePreStepMessages(decision.messages);
        if (removedCount > 0) {
          ctx.logger.warn(
            `dsh-live2d-voice/context-slim: ${sessionId.slice(0, 8)}\u2026 pre-step pruned ${removedCount} injections (${(removedBytes / 1024).toFixed(1)} KB)`
          );
        }
        return { ...decision, messages: kept };
      },
      { prepend: false }
      // run AFTER speech-guidance injection
    );
    disposers.add(stop);
  };
  const stopCreated = ctx.on("agent/created", (...args) => {
    const agent = args[0]?.agent;
    if (agent) install(agent);
  });
  for (const agent of ctx.agents?.roots?.() ?? []) {
    install(agent);
  }
  disposers.add(stopCreated);
  return () => {
    for (const dispose of disposers) dispose();
    disposers.clear();
  };
}
function loadWorkspaceConfig(cwd) {
  if (!cwd) return null;
  const filePath = join3(cwd, ".dsh", "live2d.json");
  if (!existsSync2(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync2(filePath, "utf8"));
    if (raw && typeof raw === "object") return raw;
  } catch (e) {
    console.warn(`dsh-live2d-voice: failed to parse ${filePath}: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}
function resolveSessionConfig2(agents, config, sessionId) {
  const base = resolveSessionConfig(agents, config, sessionId);
  if (!sessionId) return base;
  try {
    const agent = agents.get(sessionId);
    const cwd = agent?.session?.header?.cwd;
    if (!cwd) return base;
    const fileOverride = loadWorkspaceConfig(cwd);
    if (!fileOverride) return base;
    return {
      ...base,
      ...fileOverride,
      emotionMap: { ...base.emotionMap, ...fileOverride.emotionMap ?? {} }
    };
  } catch {
    return base;
  }
}

// src/routes.ts
import { readFileSync as readFileSync4, statSync as statSync2, existsSync as existsSync3, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, createWriteStream, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { join as join4, resolve, sep, dirname } from "node:path";
import { homedir as homedir3 } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createUserMessage as createUserMessage2 } from "@deepseek-ai/dsh-llm";

// src/asr.ts
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID as randomUUID2 } from "node:crypto";
import { readFileSync as readFileSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import WebSocket from "ws";
var ASR_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
var ASR_STREAM_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
var RESOURCE_ID = "volc.seedasr.sauc.duration";
var CHUNK_BYTES = 6400;
var STREAM_TIMEOUT_MS = 35e3;
var VOLC_ERROR_HINTS = {
  45000081: "\u8BC6\u522B\u8D85\u65F6\uFF08\u97F3\u9891\u6D41\u4E2D\u65AD\u8FC7\u4E45\uFF09",
  45000002: "\u672A\u68C0\u6D4B\u5230\u6709\u6548\u8BED\u97F3",
  55000031: "\u8BC6\u522B\u670D\u52A1\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
  45000151: "\u97F3\u9891\u683C\u5F0F\u9519\u8BEF",
  45000001: "\u8BF7\u6C42\u53C2\u6570\u9519\u8BEF"
};
function asrLanguageCode(language) {
  const map = { zh: "zh-CN", ja: "ja-JP", en: "en-US" };
  return map[language] ?? void 0;
}
function loadVolcCredentials(filePath) {
  try {
    const expanded = filePath.startsWith("~/") ? `${homedir2()}${filePath.slice(1)}` : filePath;
    const raw = JSON.parse(readFileSync3(expanded, "utf-8"));
    const apikey = typeof raw.apikey === "string" ? raw.apikey.trim() : "";
    const appid = typeof raw.appid === "string" ? raw.appid.trim() : "";
    const accessToken = typeof raw.accessToken === "string" ? raw.accessToken.trim() : "";
    if (apikey || appid && accessToken) {
      return { apikey: apikey || void 0, appid, accessToken };
    }
    return void 0;
  } catch {
    return void 0;
  }
}
function frameHeader(messageType, flags) {
  const serial = messageType === 1 ? 16 : 0;
  return Buffer.from([17, messageType << 4 | flags, serial | 1, 0]);
}
function withSize(payload) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  return Buffer.concat([size, payload]);
}
function buildFullRequest(payload, withSeq = true) {
  if (withSeq) return Buffer.concat([frameHeader(1, 1), i32(1), withSize(gzipSync(Buffer.from(JSON.stringify(payload), "utf8")))]);
  return Buffer.concat([frameHeader(1, 0), withSize(gzipSync(Buffer.from(JSON.stringify(payload), "utf8")))]);
}
function buildAudio(seq, pcm, isLast) {
  return Buffer.concat([frameHeader(2, isLast ? 3 : 1), i32(isLast ? -seq : seq), withSize(gzipSync(pcm))]);
}
function i32(value) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return b;
}
function parseFrame(data) {
  const messageType = data[1] >> 4;
  const flags = data[1] & 15;
  const compression = data[2] & 15;
  let offset = (data[0] & 15) * 4;
  if (flags & 1) offset += 4;
  const isLast = (flags & 2) !== 0;
  if (flags & 4) offset += 4;
  if (messageType === 15) {
    const code = data.readInt32BE(offset);
    offset += 8;
    return { error: true, code, isLast, payload: decodePayload(data, offset, compression) };
  }
  if (messageType !== 9) {
    return { error: false, code: 0, isLast, payload: null };
  }
  offset += 4;
  return { error: false, code: 0, isLast, payload: decodePayload(data, offset, compression) };
}
function decodePayload(data, offset, compression) {
  let body = data.subarray(Math.min(offset, data.length));
  if (body.length === 0) return null;
  if (compression === 1) {
    try {
      body = gunzipSync(body);
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(body.toString("utf-8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
function describeError(frame) {
  const payload = frame.payload ?? {};
  const detail = payload.message ?? payload.error ?? "unknown error";
  const hint = VOLC_ERROR_HINTS[frame.code];
  return `volc asr error ${frame.code}: ${hint ? `${hint}\uFF08` : ""}${String(detail)}${hint ? "\uFF09" : ""}`;
}
function recognizeUtterance(credentials, pcm, language = "auto", timeoutMs = 2e4) {
  return new Promise((resolve2, reject) => {
    if (pcm.length === 0) {
      resolve2("");
      return;
    }
    const headers = {
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Request-Id": randomUUID2()
    };
    if (credentials.apikey) headers["X-Api-Key"] = credentials.apikey;
    else {
      headers["X-Api-App-Key"] = credentials.appid;
      headers["X-Api-Access-Key"] = credentials.accessToken;
    }
    let settled = false;
    let text = "";
    let ws;
    const dispose = () => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
        else ws.terminate();
      } catch {
      }
    };
    const settle = (win) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dispose();
      win();
    };
    const fail = (message) => settle(() => reject(new Error(message)));
    const timer = setTimeout(() => fail(`volc asr: no result within ${timeoutMs}ms`), timeoutMs);
    ws = new WebSocket(ASR_URL, { headers, handshakeTimeout: 15e3 });
    ws.on("unexpected-response", (_request, response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => fail(`volc asr: handshake HTTP ${response.statusCode} ${body.slice(0, 200)}`));
    });
    ws.on("error", (error) => fail(`volc asr: ${error.message}`));
    ws.on("close", () => {
      settle(() => text ? resolve2(text) : reject(new Error("volc asr: connection closed before a result")));
    });
    ws.on("message", (data) => {
      const frame = Array.isArray(data) ? Buffer.concat(data) : data;
      let parsed;
      try {
        parsed = parseFrame(frame);
      } catch {
        return;
      }
      if (parsed.error) {
        fail(describeError(parsed));
        return;
      }
      const result = parsed.payload?.result ?? void 0;
      if (result?.text) text = result.text;
      else if (result?.utterances) {
        const joined = result.utterances.map((u) => u.text).join("");
        if (joined) text = joined;
      }
      if (parsed.isLast) settle(() => resolve2(text));
    });
    ws.on("open", () => {
      const code = asrLanguageCode(language);
      const request = {
        user: { uid: "dsh-live2d-voice" },
        audio: {
          format: "pcm",
          codec: "raw",
          rate: 16e3,
          bits: 16,
          channel: 1,
          ...code ? { language: code } : {}
        },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          show_utterances: true,
          result_type: "full",
          ...code ? {} : { enable_auto_lang: true }
        }
      };
      try {
        ws.send(buildFullRequest(request));
        let seq = 1;
        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
          seq += 1;
          const chunk = pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length));
          const isLast = offset + CHUNK_BYTES >= pcm.length;
          ws.send(buildAudio(seq, chunk, isLast));
        }
      } catch (error) {
        fail(`volc asr: send failed (${error instanceof Error ? error.message : String(error)})`);
      }
    });
  });
}
var StreamingAsrSession = class {
  ws;
  onInterim;
  settled = false;
  failure = null;
  /** Frames that arrived before the WS opened (forwarded on open). */
  pending = [];
  /** Frames buffered toward one 200ms upstream packet. */
  buffer = [];
  buffered = 0;
  finalText = "";
  finalPromise = null;
  finalResolve = null;
  finalReject = null;
  timer;
  constructor(credentials, onInterim) {
    this.onInterim = onInterim;
    const headers = {
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Request-Id": randomUUID2(),
      "X-Api-Sequence": "-1"
    };
    if (credentials.apikey) headers["X-Api-Key"] = credentials.apikey;
    else {
      headers["X-Api-App-Key"] = credentials.appid;
      headers["X-Api-Access-Key"] = credentials.accessToken;
    }
    this.timer = setTimeout(() => this.fail(new Error(`volc asr stream: no result within ${STREAM_TIMEOUT_MS}ms`)), STREAM_TIMEOUT_MS);
    this.ws = new WebSocket(ASR_STREAM_URL, { headers, handshakeTimeout: 15e3 });
    this.ws.on("unexpected-response", (_request, response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => this.fail(new Error(`volc asr stream: handshake HTTP ${response.statusCode} ${body.slice(0, 200)}`)));
    });
    this.ws.on("error", (error) => this.fail(new Error(`volc asr stream: ${error.message}`)));
    this.ws.on("close", () => {
      if (!this.settled) this.fail(new Error("volc asr stream: connection closed before a result"));
    });
    this.ws.on("open", () => {
      try {
        this.ws.send(buildFullRequest(
          {
            user: { uid: "dsh-live2d-voice" },
            audio: { format: "pcm", codec: "raw", rate: 16e3, bits: 16, channel: 1 },
            request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, enable_ddc: false, result_type: "full", show_utterances: true, enable_nonstream: true }
          },
          false
        ));
      } catch (error) {
        this.fail(new Error(`volc asr stream: send failed (${error instanceof Error ? error.message : String(error)})`));
        return;
      }
      for (const frame of this.pending) this.sendRaw(frame);
      this.pending = [];
    });
    this.ws.on("message", (data) => this.onMessage(data));
  }
  /** Feed one chunk of 16kHz s16le mono PCM (any size; batched to 200ms packets). */
  feed(pcm) {
    if (this.settled || this.failure) return;
    this.buffer.push(pcm);
    this.buffered += pcm.length;
    if (this.buffered >= CHUNK_BYTES) this.flush(false);
  }
  /**
   * End the utterance and resolve with the final transcript. Repeat calls
   * return the same promise; safe before `feed` ever ran.
   */
  end() {
    if (this.finalPromise === null) {
      this.finalPromise = new Promise((resolve2, reject) => {
        this.finalResolve = resolve2;
        this.finalReject = reject;
      });
      if (this.failure) this.settleFailure();
      else this.flush(true);
    }
    return this.finalPromise;
  }
  /** Discard the session (blip, mic closed mid-word) — no result. */
  abort() {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.dispose();
    this.finalReject?.(new Error("volc asr stream: aborted"));
  }
  onMessage(data) {
    const frame = Array.isArray(data) ? Buffer.concat(data) : data;
    let parsed;
    try {
      parsed = parseFrame(frame);
    } catch {
      return;
    }
    if (parsed.error) {
      this.fail(new Error(describeError(parsed)));
      return;
    }
    const result = parsed.payload?.result ?? void 0;
    if (result?.text) {
      this.finalText = result.text;
      this.onInterim?.(this.finalText);
    } else if (result?.utterances) {
      const joined = result.utterances.map((u) => u.text).join("");
      if (joined) {
        this.finalText = joined;
        this.onInterim?.(this.finalText);
      }
    }
    if (parsed.isLast) {
      if (!this.settled) {
        this.settled = true;
        clearTimeout(this.timer);
        this.dispose();
        this.finalResolve?.(this.finalText);
      }
    }
  }
  flush(withLast) {
    if (this.buffered === 0) {
      if (withLast) this.sendLast();
      return;
    }
    const body = Buffer.concat(this.buffer);
    this.buffer = [];
    this.buffered = 0;
    this.sendRaw(Buffer.concat([frameHeader(2, 0), withSize(gzipSync(body))]));
    if (withLast) this.sendLast();
  }
  sendLast() {
    this.sendRaw(Buffer.concat([frameHeader(2, 2), withSize(gzipSync(Buffer.alloc(0)))]));
  }
  sendRaw(frame) {
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
      else this.pending.push(frame);
    } catch (error) {
      this.fail(new Error(`volc asr stream: send failed (${error instanceof Error ? error.message : String(error)})`));
    }
  }
  fail(error) {
    if (this.settled) return;
    this.failure = error;
    this.settleFailure();
  }
  settleFailure() {
    if (this.finalReject === null) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.dispose();
    const reject = this.finalReject;
    const error = this.failure ?? new Error("volc asr stream: failed");
    this.finalReject = null;
    reject(error);
  }
  dispose() {
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
      else this.ws.terminate();
    } catch {
    }
  }
};

// src/routes.ts
var BODY_MAX_BYTES = 64 * 1024;
var PCM_MAX_BYTES = 2 * 1024 * 1024;
var PCM_MIN_BYTES = 3200;
var MODELS_PREFIX = "/live2d-voice/models";
var GAZE_PREFIX = "/live2d-voice/gaze";
var FACE_LANDMARKER_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
var FACE_LANDMARKER_MAX_BYTES = 16 * 1024 * 1024;
var CORE_SCRIPT_PATH = "/live2d-voice/core/live2dcubismcore.min.js";
var CORE2_SCRIPT_PATH = "/live2d-voice/core/live2d.min.js";
function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req, maxBytes = BODY_MAX_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body too large");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("body must be a JSON object");
  return parsed;
}
function projectionTitle(values) {
  if (!values) return void 0;
  for (const [key, value] of Object.entries(values)) {
    if (!key.includes("title")) continue;
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object" && "value" in value) {
      const inner = value.value;
      if (typeof inner === "string" && inner) return inner;
    }
  }
  return void 0;
}
async function readRawBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function publicConfig(config, keyCount) {
  const { apiKeys: _apiKeys, ...rest } = config;
  const asrConfigured = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) !== void 0 : false;
  return { ...rest, apiKeyCount: keyCount, asrConfigured };
}
function mimeOf(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
function serveFile(res, path, maxAgeSeconds) {
  let data;
  try {
    data = readFileSync4(path);
  } catch {
    return false;
  }
  res.writeHead(200, { "content-type": mimeOf(path), "cache-control": `public, max-age=${maxAgeSeconds}` });
  res.end(data);
  return true;
}
function modelUrl(entry) {
  return `${MODELS_PREFIX}/${entry.relative.split("/").map(encodeURIComponent).join("/")}`;
}
function installRoutes(ctx, deps) {
  const webServer = ctx.get("webServer", false);
  if (webServer === void 0 || webServer === null) {
    ctx.logger.info("dsh-live2d-voice: no webserver composed; web routes not installed.");
    return void 0;
  }
  const disposers = [];
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/stream", handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim();
      if (!sessionId) {
        writeJson(res, 400, { code: "session_required", message: "query parameter `session` is required" });
        return;
      }
      deps.hub.attach(sessionId, req, res);
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/asr/recognize", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void (async () => {
        const config = deps.getConfig();
        const credentials = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) : void 0;
        if (credentials === void 0) {
          writeJson(res, 500, { ok: false, error: "\u672A\u914D\u7F6E\u706B\u5C71 ASR \u51ED\u8BC1\uFF08live2d-voice.json \u2192 asrCredentialsFile\uFF0CJSON \u9700\u542B apikey \u6216 appid+accessToken\uFF09" });
          return;
        }
        const language = new URL(req.url ?? "/", "http://localhost").searchParams.get("lang")?.trim() || config.sttLanguage || "auto";
        let pcm;
        try {
          pcm = await readRawBody(req, PCM_MAX_BYTES);
        } catch (error) {
          writeJson(res, 413, { ok: false, error: error instanceof Error ? error.message : String(error) });
          return;
        }
        if (pcm.length < PCM_MIN_BYTES) {
          writeJson(res, 400, { ok: false, error: "\u97F3\u9891\u8FC7\u77ED\uFF08\u4E0D\u8DB3 100ms\uFF09" });
          return;
        }
        const text = await recognizeUtterance(credentials, pcm, language);
        writeJson(res, 200, { ok: true, text });
      })().catch((error) => {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  const asrWss = new WebSocketServer({ noServer: true });
  disposers.push(
    webServer.registerUpgrade({ path: "/live2d-voice/asr/ws", handler: (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const sessionId = url.searchParams.get("session")?.trim() ?? "";
      const up = url.searchParams.get("up")?.trim() ?? "";
      if (!sessionId) {
        socket.destroy();
        return;
      }
      const config = deps.getConfig();
      const credentials = config.asrCredentialsFile ? loadVolcCredentials(config.asrCredentialsFile) : void 0;
      if (credentials === void 0) {
        socket.destroy();
        return;
      }
      asrWss.handleUpgrade(req, socket, head, (ws) => {
        const emitInterim = (text) => deps.hub.emit(sessionId, "asr-interim", { text, up });
        const session = new StreamingAsrSession(credentials, emitInterim);
        let finalized = false;
        let size = 0;
        ws.on("message", (data, isBinary) => {
          if (finalized) return;
          if (isBinary) {
            const chunk = data;
            size += chunk.length;
            if (size > PCM_MAX_BYTES) {
              session.abort();
              ws.close();
              return;
            }
            session.feed(chunk);
            return;
          }
          try {
            const control = JSON.parse(String(data));
            if (control.t === "finish") {
              finalized = true;
              void session.end().then((text) => deps.hub.emit(sessionId, "asr-final", { text, up })).catch((error) => {
                deps.hub.emit(sessionId, "error", { message: error instanceof Error ? error.message : String(error) });
              }).finally(() => ws.close());
            } else if (control.t === "abort") {
              finalized = true;
              session.abort();
              ws.close();
            }
          } catch {
          }
        });
        ws.on("close", () => {
          if (!finalized) session.abort();
        });
        ws.on("error", () => {
          if (!finalized) session.abort();
        });
      });
    } })
  );
  disposers.push(() => {
    for (const client of asrWss.clients) client.terminate();
    asrWss.close();
  });
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/config", handler: (req, res) => {
      if (req.method === "GET") {
        const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
        const global = deps.getConfig();
        const config = sessionId ? resolveSessionConfig(ctx.agents, global, sessionId) : global;
        writeJson(res, 200, {
          config: publicConfig(config, deps.resolveKeys(global).length),
          presets: VOICE_PRESETS,
          voiceLanguages: VOICE_LANGUAGES,
          languages: LANGUAGE_OPTIONS
        });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then((body) => {
        const patch = {};
        for (const key of ["modelPath", "modelSelection", "voiceId", "ttsModel", "apiKeyFile", "sttLanguage", "asrMode", "asrCredentialsFile", "speechLanguage", "subtitleLanguage", "speechPrompt", "playerModelSelection", "playerVoiceId", "playerSpeechLanguage", "playerPrompt"]) {
          if (typeof body[key] === "string") patch[key] = body[key];
        }
        if (typeof body.eyeTracking === "boolean") patch.eyeTracking = body.eyeTracking;
        if (typeof body.gyroParallax === "boolean") patch.gyroParallax = body.gyroParallax;
        if (typeof body.idleInterval === "number") patch.idleInterval = body.idleInterval;
        if (typeof body.sentenceSubtitles === "boolean") patch.sentenceSubtitles = body.sentenceSubtitles;
        if (body.liveMode === "first" || body.liveMode === "third" || body.liveMode === "call") patch.liveMode = body.liveMode;
        if (typeof body.playerPolish === "boolean") patch.playerPolish = body.playerPolish;
        if (Array.isArray(body.apiKeys)) {
          patch.apiKeys = body.apiKeys.filter((key) => typeof key === "string" && key.length > 0);
        }
        if (typeof body.emotionMap === "object" && body.emotionMap !== null && !Array.isArray(body.emotionMap)) {
          const emotionMap = {};
          for (const [emotion, expression] of Object.entries(body.emotionMap)) {
            if (typeof expression === "number" || typeof expression === "string") emotionMap[emotion] = expression;
          }
          patch.emotionMap = emotionMap;
        }
        if (typeof body.playerEmotionMap === "object" && body.playerEmotionMap !== null && !Array.isArray(body.playerEmotionMap)) {
          const playerEmotionMap = {};
          for (const [emotion, expression] of Object.entries(body.playerEmotionMap)) {
            if (typeof expression === "number" || typeof expression === "string") playerEmotionMap[emotion] = expression;
          }
          patch.playerEmotionMap = playerEmotionMap;
        }
        const modelPatchValue = (key) => {
          const v = body[key];
          if (v === null) return null;
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            const m = v;
            if (typeof m.provider === "string" && typeof m.model === "string") {
              return {
                provider: m.provider,
                model: m.model,
                ...typeof m.reasoningEffort === "string" && m.reasoningEffort ? { reasoningEffort: m.reasoningEffort } : {}
              };
            }
          }
          return void 0;
        };
        for (const key of ["liveModel", "translateModel", "polishModel"]) {
          const v = modelPatchValue(key);
          if (v !== void 0) patch[key] = v;
        }
        const saved = deps.saveConfig(patch);
        writeJson(res, 200, { config: publicConfig(saved, deps.resolveKeys(saved).length) });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_config", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/message", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then(async (body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const mode = body.mode === "steer" ? "steer" : "queue";
        if (!sessionId || !text) {
          writeJson(res, 400, { code: "bad_message", message: "sessionId and text are required" });
          return;
        }
        let agent = ctx.agents.get(sessionId);
        if (agent === void 0) {
          const found = await ctx.sessionController.resolveAgent(sessionId);
          if (found !== void 0 && "agent" in found && found.agent !== void 0) {
            agent = found.agent;
          } else {
            const detail = found !== void 0 && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
            writeJson(res, 404, { code: "session_not_found", message: detail });
            return;
          }
        }
        const content = [{ type: "text", text }];
        const message = createUserMessage2({ content, source: { kind: "user" } });
        if (mode === "steer") agent.steer(message);
        else agent.followup(message);
        deps.hub.emit(sessionId, "subtitle", { role: "user", text });
        writeJson(res, 200, { accepted: true });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_message", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/session", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then(async (body) => {
        const request = {};
        if (typeof body.sessionId === "string" && body.sessionId) request.sessionId = body.sessionId;
        if (typeof body.cwd === "string" && body.cwd) request.cwd = body.cwd;
        if (typeof body.agentPreset === "string" && body.agentPreset) request.agentPreset = body.agentPreset;
        const controller = ctx.sessionController;
        const created = await controller.create(request);
        writeJson(res, 200, { ok: true, sessionId: created.sessionId, agentPreset: created.agentPreset });
      }).catch((error) => {
        writeJson(res, 500, { ok: false, code: "create_failed", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/sessions", handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      const controller = ctx.sessionController;
      const abort = new AbortController();
      req.on("close", () => abort.abort());
      void controller.list({}, abort.signal).then((value) => {
        const items = value.items.map((summary) => ({
          sessionId: summary.sessionId,
          updatedAt: summary.updatedAt,
          running: summary.running,
          blank: summary.blank,
          cwd: summary.cwd,
          title: projectionTitle(summary.projections?.values)
        }));
        writeJson(res, 200, { ok: true, items });
      }).catch((error) => {
        writeJson(res, 500, { ok: false, code: "list_failed", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/player-line", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then((body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const mode = body.mode === "steer" ? "steer" : "queue";
        if (!sessionId || !text) {
          writeJson(res, 400, { code: "bad_message", message: "sessionId and text are required" });
          return;
        }
        deps.playerPipeline.submit(sessionId, text, mode);
        writeJson(res, 200, { accepted: true });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/camera-result", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req, 9 * 1024 * 1024).then((body) => {
        const requestId = typeof body.requestId === "string" ? body.requestId : "";
        const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
        const width = Number(body.width) || 0;
        const height = Number(body.height) || 0;
        if (!requestId) {
          writeJson(res, 400, { code: "bad_request", message: "requestId is required" });
          return;
        }
        if (dataUrl.length > 8 * 1024 * 1024) {
          writeJson(res, 413, { code: "too_large", message: "image too large" });
          return;
        }
        const shot = dataUrl.startsWith("data:image/jpeg") ? { dataUrl, width, height } : null;
        writeJson(res, 200, { ok: deps.cameraBridge.deliver(requestId, shot) });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/model", handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
      const config = sessionId ? resolveSessionConfig(ctx.agents, deps.getConfig(), sessionId) : deps.getConfig();
      const catalog = resolveModelCatalog(config);
      const entry = resolveModelSelection(config, catalog);
      const playerEntry = config.playerModelSelection ? catalog.find((model) => model.name === config.playerModelSelection) : void 0;
      const showsPlayer = config.liveMode === "third" || config.liveMode === "call";
      const playerMotions = showsPlayer && playerEntry ? extractModelMotions(join4(config.modelPath, playerEntry.relative)) : [];
      const player = showsPlayer && playerEntry ? { name: playerEntry.name, label: playerEntry.label, kind: playerEntry.kind, url: modelUrl(playerEntry), motions: playerMotions } : void 0;
      if (entry === void 0) {
        writeJson(res, 200, { configured: Boolean(config.modelPath), url: void 0, liveMode: config.liveMode, player });
        return;
      }
      const motions = extractModelMotions(join4(config.modelPath, entry.relative));
      writeJson(res, 200, {
        configured: true,
        url: modelUrl(entry),
        name: entry.name,
        label: entry.label,
        kind: entry.kind,
        group: entry.group,
        groupLabel: entry.group ? GROUP_LABELS[entry.group] ?? entry.group : void 0,
        current: entry.name,
        motions,
        models: catalog.map((model) => ({
          name: model.name,
          label: model.label,
          kind: model.kind,
          group: model.group,
          groupLabel: model.group ? GROUP_LABELS[model.group] ?? model.group : void 0,
          url: modelUrl(model)
        })),
        liveMode: config.liveMode,
        player
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "prefix", path: MODELS_PREFIX, handler: (req, res) => {
      const config = deps.getConfig();
      const roots = [];
      for (const override of Object.values(config.workspaces ?? {})) {
        const path = typeof override.modelPath === "string" ? override.modelPath.trim() : "";
        if (path && !roots.includes(resolve(path))) roots.push(resolve(path));
      }
      if (config.modelPath && !roots.includes(resolve(config.modelPath))) roots.push(resolve(config.modelPath));
      if (roots.length === 0) {
        writeJson(res, 404, { code: "model_not_configured" });
        return;
      }
      const url = (req.url ?? "").split("?")[0];
      let relative;
      try {
        relative = decodeURIComponent(url.slice(MODELS_PREFIX.length));
      } catch {
        writeJson(res, 400, { code: "bad_path" });
        return;
      }
      for (const root of roots) {
        const target = resolve(join4(root, relative));
        if (target !== root && !target.startsWith(root + sep)) continue;
        let isFile;
        try {
          isFile = statSync2(target).isFile();
        } catch {
          isFile = false;
        }
        if (isFile && serveFile(res, target, 3600)) return;
      }
      writeJson(res, 404, { code: "not_found" });
    } })
  );
  let mediapipeDir = "";
  const resolveMediapipeDir = () => {
    if (mediapipeDir) return mediapipeDir;
    try {
      const require2 = createRequire(import.meta.url);
      let dir = dirname(require2.resolve("@mediapipe/tasks-vision"));
      for (let i = 0; i < 4; i++) {
        if (existsSync3(join4(dir, "wasm")) && existsSync3(join4(dir, "vision_bundle.mjs"))) {
          mediapipeDir = dir;
          return dir;
        }
        dir = dirname(dir);
      }
    } catch {
    }
    return "";
  };
  const gazeModelCache = (() => {
    const dir = join4(process.env.DSH_HOME ?? resolve(homedir3(), ".dsh"), "live2d-voice-cache");
    try {
      if (!existsSync3(dir)) mkdirSync2(dir, { recursive: true });
      return join4(dir, "face_landmarker.task");
    } catch {
      return "";
    }
  })();
  let gazeModelPromise = null;
  const ensureGazeModel = () => {
    if (gazeModelCache && existsSync3(gazeModelCache)) return Promise.resolve(gazeModelCache);
    gazeModelPromise ??= (async () => {
      if (!gazeModelCache) throw new Error("cache dir unavailable");
      const response = await fetch(FACE_LANDMARKER_URL);
      if (!response.ok || !response.body) throw new Error(`model download failed: HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > FACE_LANDMARKER_MAX_BYTES) throw new Error("model download too large");
      const temp = `${gazeModelCache}.tmp`;
      await pipeline(response.body, createWriteStream(temp));
      const stat = statSync2(temp);
      if (stat.size > FACE_LANDMARKER_MAX_BYTES || stat.size < 1024) throw new Error("model download corrupt");
      writeFileSync2(gazeModelCache, readFileSync4(temp));
      rmSync(temp, { force: true });
      return gazeModelCache;
    })().catch((error) => {
      gazeModelPromise = null;
      throw error;
    });
    return gazeModelPromise;
  };
  disposers.push(
    webServer.register({ kind: "prefix", path: GAZE_PREFIX, handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      const url = (req.url ?? "").split("?")[0];
      let relative;
      try {
        relative = decodeURIComponent(url.slice(GAZE_PREFIX.length)).replace(/^\/+/, "");
      } catch {
        writeJson(res, 400, { code: "bad_path" });
        return;
      }
      void (async () => {
        if (relative === "model") {
          const file = await ensureGazeModel();
          if (!serveFile(res, file, 86400)) writeJson(res, 502, { code: "model_unavailable" });
          return;
        }
        if (!resolveMediapipeDir()) {
          writeJson(res, 404, { code: "mediapipe_missing" });
          return;
        }
        if (relative === "vision.mjs") {
          if (!serveFile(res, join4(mediapipeDir, "vision_bundle.mjs"), 0)) writeJson(res, 404, { code: "not_found" });
          return;
        }
        if (relative.startsWith("wasm/")) {
          const root = resolve(join4(mediapipeDir, "wasm"));
          const target = resolve(join4(root, relative.slice(5)));
          if (target !== root && !target.startsWith(root + sep)) {
            writeJson(res, 403, { code: "path_forbidden" });
            return;
          }
          if (!serveFile(res, target, 86400)) writeJson(res, 404, { code: "not_found" });
          return;
        }
        writeJson(res, 404, { code: "not_found" });
      })().catch((error) => {
        writeJson(res, 502, { code: "gaze_asset_error", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice", handler: (_req, res) => {
      const page = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/picker.html");
      if (!serveFile(res, page, 0)) writeJson(res, 404, { code: "picker_missing" });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/app", handler: (_req, res) => {
      const page = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/standalone.html");
      if (!serveFile(res, page, 0)) writeJson(res, 404, { code: "standalone_missing" });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/app/bundle.js", handler: (_req, res) => {
      const bundle = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/standalone.js");
      if (!serveFile(res, bundle, 0)) writeJson(res, 404, { code: "standalone_bundle_missing" });
    } })
  );
  const corePath = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/cubism4/live2dcubismcore.min.js");
  disposers.push(
    webServer.register({ kind: "exact", path: CORE_SCRIPT_PATH, handler: (_req, res) => {
      if (!serveFile(res, corePath, 86400)) writeJson(res, 404, { code: "core_missing" });
    } })
  );
  const core2Path = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/cubism2/live2d.min.js");
  disposers.push(
    webServer.register({ kind: "exact", path: CORE2_SCRIPT_PATH, handler: (_req, res) => {
      if (!serveFile(res, core2Path, 86400)) writeJson(res, 404, { code: "core2_missing" });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/client-log", handler: async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      try {
        const body = await readJsonBody(req, 32 * 1024);
        const level = String(body.level || "info").toLowerCase();
        const msg = String(body.message || "(empty message)");
        const details = body.details ? ` | ${typeof body.details === "object" ? JSON.stringify(body.details) : String(body.details)}` : "";
        const sid = body.sessionId ? ` [sid:${String(body.sessionId).slice(0, 8)}]` : "";
        const logLine = `[dsh-live2d-voice:client]${sid} ${msg}${details}`;
        if (level === "error") {
          ctx.logger.error(logLine);
        } else if (level === "warn") {
          ctx.logger.warn(logLine);
        } else {
          ctx.logger.info(logLine);
        }
        writeJson(res, 200, { ok: true });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: String(error?.message ?? error) });
      }
    } })
  );
  disposers.push(
    ctx.on("webserver/index-inject", (table) => {
      table.push({ kind: "script-src", placement: "head", src: CORE_SCRIPT_PATH });
      table.push({ kind: "script-src", placement: "head", src: CORE2_SCRIPT_PATH });
    })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/enter-live", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then(async (body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) {
          writeJson(res, 400, { code: "session_required", message: "sessionId is required" });
          return;
        }
        let agent = ctx.agents.get(sessionId);
        if (agent === void 0) {
          const sc2 = ctx.sessionController;
          const found = await sc2.resolveAgent(sessionId);
          if (found !== void 0 && "agent" in found && found.agent !== void 0) {
            agent = found.agent;
          } else {
            const detail = found !== void 0 && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
            writeJson(res, 404, { code: "session_not_found", message: detail });
            return;
          }
        }
        const message = createUserMessage2({
          content: [{ type: "text", text: "Enter live mode." }],
          source: { kind: "user" }
        });
        agent.followup(message);
        const sc = ctx.sessionController;
        const requestCancel = () => {
          try {
            sc.cancel({ sessionId });
          } catch {
          }
        };
        requestCancel();
        globalThis.setTimeout(requestCancel, 120);
        writeJson(res, 200, { ok: true });
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/model-catalog", handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void (async () => {
        try {
          const sc = ctx.sessionController;
          const catalog = await sc.modelCatalog();
          writeJson(res, 200, catalog);
        } catch (error) {
          writeJson(res, 500, { code: "catalog_error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/model-selection", handler: (req, res) => {
      if (req.method !== "GET") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void (async () => {
        const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session")?.trim() ?? "";
        if (!sessionId) {
          writeJson(res, 400, { code: "session_required", message: "query parameter `session` is required" });
          return;
        }
        try {
          const sc = ctx.sessionController;
          const found = await sc.resolveAgent(sessionId);
          const agent = found?.agent;
          const header = agent?.session?.requestHeader?.();
          if (header?.config) {
            writeJson(res, 200, {
              provider: header.config.provider,
              model: header.config.model,
              ...header.config.reasoningEffort === void 0 ? {} : { reasoningEffort: header.config.reasoningEffort }
            });
            return;
          }
          const catalog = await sc.modelCatalog();
          writeJson(res, 200, catalog.default);
        } catch (error) {
          writeJson(res, 500, { code: "selection_error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    } })
  );
  disposers.push(
    webServer.register({ kind: "exact", path: "/live2d-voice/select-model", handler: (req, res) => {
      if (req.method !== "POST") {
        writeJson(res, 405, { code: "method_not_allowed" });
        return;
      }
      void readJsonBody(req).then(async (body) => {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const provider = typeof body.provider === "string" ? body.provider : "";
        const model = typeof body.model === "string" ? body.model : "";
        const reasoningEffort = typeof body.reasoningEffort === "string" ? body.reasoningEffort : void 0;
        if (!sessionId || !provider || !model) {
          writeJson(res, 400, { code: "bad_request", message: "sessionId, provider, and model are required" });
          return;
        }
        const sc = ctx.sessionController;
        const result = await sc.selectModel({ sessionId, provider, model, reasoningEffort });
        writeJson(res, 200, result);
      }).catch((error) => {
        writeJson(res, 400, { code: "bad_request", message: error instanceof Error ? error.message : String(error) });
      });
    } })
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}

// src/camera-tool.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
var CAPTURE_TIMEOUT_MS = 25e3;
var CameraBridge = class {
  constructor(hub) {
    this.hub = hub;
  }
  hub;
  pending = /* @__PURE__ */ new Map();
  /** Ask the session's Live view for a camera frame. Resolves null on timeout. */
  request(sessionId) {
    return new Promise((resolve2) => {
      const requestId = randomUUID3().slice(0, 12);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve2(null);
      }, CAPTURE_TIMEOUT_MS);
      this.pending.set(requestId, { resolve: resolve2, timer });
      this.hub.emit(sessionId, "camera-capture", { requestId });
    });
  }
  /** The browser delivered (or failed) — called by the result route. */
  deliver(requestId, shot) {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(shot);
    return true;
  }
};
function applyCameraTool(ctx, hub, bridge) {
  const registered = /* @__PURE__ */ new WeakSet();
  const registerOne = (agent) => {
    if (registered.has(agent)) return;
    registered.add(agent);
    agent.ctx.effect(
      () => agent.ctx.tools.register(
        defineTool({
          name: "look_at_user",
          description: "Take one photo from the front camera of the device where the user is watching you (the Live2D voice view), so you can actually see the user and their surroundings. Use it when the user asks you to look at them or at something near them\uFF08\u4F8B\u5982\u7528\u6237\u8BF4\u300C\u770B\u770B\u6211\u300D\u300C\u4F60\u770B\u6211\u8FD9\u8FB9\u300D\uFF09. The photo is taken only with the browser's explicit camera permission on the user's own device. Only available while the user has the Live2D view open; if it errors, tell the user you cannot see them right now.",
          parameters: {},
          output: {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                ok: { type: "boolean", required: true },
                error: { type: "string" },
                /** Opaque image attachment reference (on success). */
                ref: { type: "object", additionalProperties: true }
              }
            },
            render: (_args, value) => {
              if (!value.ok || !value.ref) {
                return [{ type: "text", text: `(\u62CD\u7167\u5931\u8D25\uFF1A${value.error ?? "\u672A\u77E5\u9519\u8BEF"})` }];
              }
              return [
                { type: "image", attachment: value.ref },
                { type: "text", text: "(\u4E00\u5F20\u521A\u4ECE\u524D\u7F6E\u6444\u50CF\u5934\u62CD\u6444\u7684\u7167\u7247)" }
              ];
            }
          },
          async execute(_args, exec) {
            const sessionId = String(exec.agent?.id ?? "");
            if (!sessionId || !hub.has(sessionId)) {
              return { ok: false, error: "Live2D \u89C6\u56FE\u672A\u6253\u5F00\u2014\u2014\u7528\u6237\u73B0\u5728\u770B\u4E0D\u5230\u4F60\uFF0C\u4E5F\u65E0\u6CD5\u62CD\u7167" };
            }
            const shot = await bridge.request(sessionId);
            if (!shot) return { ok: false, error: "\u6444\u50CF\u5934\u4E0D\u53EF\u7528\u6216\u8D85\u65F6\u672A\u54CD\u5E94" };
            const base64 = shot.dataUrl.includes(",") ? shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1) : shot.dataUrl;
            const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
            const ref = await ctx.attachments.saveImage({
              data: bytes,
              mediaType: "image/jpeg",
              name: "camera.jpg"
            });
            return { ok: true, ref };
          }
        })
      )
    );
  };
  const offCreated = ctx.on("agent/created", (payload) => {
    const a = payload.agent;
    if (!a?.ctx || a.id === void 0) return;
    if (!hub.has(String(a.id))) return;
    registerOne(a);
  });
  const offFirstOpen = hub.onFirstOpen((sessionId) => {
    const agent = ctx.agents.get(sessionId);
    if (agent?.ctx) registerOne(agent);
  });
  return () => {
    offCreated();
    offFirstOpen();
  };
}

// src/player.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { createUserMessage as createUserMessage3 } from "@deepseek-ai/dsh-llm";
import { ReasoningEffortId as ReasoningEffortId2 } from "@deepseek-ai/dsh-llm/brand";
var POLISH_TIMEOUT_MS = 2e4;
var PlayerPipeline = class {
  constructor(ctx, deps) {
    this.ctx = ctx;
    this.deps = deps;
    this.stopListening = deps.hub.onLastClose((sessionId) => {
      this.controllers.get(sessionId)?.abort();
      this.controllers.delete(sessionId);
    });
  }
  ctx;
  deps;
  queues = /* @__PURE__ */ new Map();
  controllers = /* @__PURE__ */ new Map();
  stopListening;
  dispose() {
    this.stopListening();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.queues.clear();
  }
  /**
   * Enqueue one player line. Returns immediately; the polished line, its
   * audio, and the assistant reply all arrive over the session SSE.
   */
  submit(sessionId, rawText, mode) {
    const text = rawText.trim();
    if (!text) return;
    const tail = this.queues.get(sessionId) ?? Promise.resolve();
    const run = tail.catch(() => void 0).then(() => this.process(sessionId, text, mode)).catch((error) => {
      this.deps.hub.emit(sessionId, "error", {
        message: `\u73A9\u5BB6\u53F0\u8BCD\u5904\u7406\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
      });
    });
    this.queues.set(sessionId, run);
    void run.then(() => {
      if (this.queues.get(sessionId) === run) this.queues.delete(sessionId);
    });
  }
  async process(sessionId, text, mode) {
    const config = this.deps.resolveSession(sessionId);
    if (config.liveMode !== "third") {
      await this.submitToAgent(sessionId, text, mode);
      return;
    }
    this.deps.supersedeAssistant(sessionId);
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    const utteranceId = randomUUID4().slice(0, 8);
    try {
      let finalText = text;
      if (config.playerPolish && this.deps.hub.has(sessionId)) {
        const polished = await this.polish(sessionId, text, config, controller.signal);
        if (polished) finalText = polished;
      }
      const vocabulary = new Set(Object.keys(config.playerEmotionMap));
      const { clean, emotions } = extractEmotionTags(finalText, vocabulary);
      const emotion = emotions.at(-1);
      const expression = emotion === void 0 ? void 0 : config.playerEmotionMap[emotion];
      const spoken = clean.trim() || text;
      if (this.deps.hub.has(sessionId)) {
        await this.speak(sessionId, utteranceId, spoken, config, controller.signal, emotion, expression);
      }
      await this.submitToAgent(sessionId, spoken, mode);
    } finally {
      if (this.controllers.get(sessionId) === controller) this.controllers.delete(sessionId);
    }
  }
  /** One-shot polish call; "" means "fall back to the raw text". */
  async polish(sessionId, text, config, signal) {
    const pm = config.polishModel;
    const model = pm ? { provider: pm.provider, model: pm.model, ...pm.reasoningEffort ? { reasoningEffort: pm.reasoningEffort } : {} } : await this.resolveSessionModel(sessionId);
    if (model === void 0 || signal.aborted) return "";
    const vocabulary = Object.keys(config.playerEmotionMap);
    const lines = [
      "\u4F60\u662F\u89D2\u8272\u626E\u6F14\u53F0\u672C\u5E08\u3002\u7528\u6237\u53D1\u6765\u4ED6\u60F3\u5BF9\u53E6\u4E00\u4E2A\u89D2\u8272\u8BF4\u7684\u8BDD\uFF08\u53EF\u80FD\u662F\u53E3\u8BED\u3001\u968F\u624B\u6253\u5B57\u6216\u53E6\u4E00\u79CD\u8BED\u8A00\uFF09\uFF0C\u8BF7\u6539\u5199\u6210\u7531\u7528\u6237\u7684\u89D2\u8272\u5316\u8EAB\u4EB2\u53E3\u8BF4\u51FA\u7684\u53F0\u8BCD\u3002",
      "- \u4FDD\u7559\u539F\u6587\u7684\u5168\u90E8\u4FE1\u606F\u70B9\u4E0E\u610F\u56FE\uFF0C\u957F\u5EA6\u968F\u5185\u5BB9\u800C\u5B9A\uFF1B\u53EA\u6709\u7B80\u77ED\u5BD2\u6684\u624D\u6536\u655B\u4E3A\u4E24\u53E5\u4EE5\u5185\u3002",
      "- \u53F0\u8BCD\u53E3\u8BED\u5316\u3001\u81EA\u7136\u3001\u9002\u5408\u76F4\u63A5\u6717\u8BFB\uFF1B\u4E0D\u8981 Markdown\u3001\u5217\u8868\u3001\u62EC\u53F7\u52A8\u4F5C\u8BF4\u660E\u6216\u65C1\u767D\u3002",
      `- \u5728\u53F0\u8BCD\u5F00\u5934\u7528\u4E00\u4E2A\u65B9\u62EC\u53F7\u60C5\u7EEA\u6807\u7B7E\u6807\u6CE8\u60C5\u7EEA\uFF0C\u53EA\u80FD\u4ECE\u8FD9\u4E9B\u6807\u7B7E\u91CC\u9009\uFF1A${vocabulary.map((e) => `[${e}]`).join(" ")}\uFF1B\u6CA1\u6709\u660E\u663E\u60C5\u7EEA\u53EF\u7701\u7565\u3002`
    ];
    const language = config.playerSpeechLanguage;
    lines.push(language && language !== "auto" ? `- \u53F0\u8BCD\u59CB\u7EC8\u7528${languageLabel(language)}\u8BF4\u51FA\u3002` : "- \u53F0\u8BCD\u8BED\u8A00\u8DDF\u968F\u539F\u6587\u8BED\u8A00\u3002");
    const persona = config.playerPrompt.trim();
    if (persona) lines.push(`- \u7528\u6237\u89D2\u8272\u7684\u4EBA\u8BBE\uFF1A${persona}`);
    lines.push("\u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u53F0\u8BCD\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u5F15\u53F7\u6216\u539F\u6587\u3002");
    const capped = new AbortController();
    const capTimer = setTimeout(() => capped.abort(), POLISH_TIMEOUT_MS);
    const forwardAbort = () => capped.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    let out = "";
    try {
      const stream = this.ctx.llm.stream({
        provider: model.provider,
        model: model.model,
        messages: [createUserMessage3({ content: [{ type: "text", text }], source: { kind: "user" } })],
        system: lines.join("\n"),
        ...model.reasoningEffort ? { reasoningEffort: ReasoningEffortId2(model.reasoningEffort) } : {},
        signal: capped.signal
      });
      for await (const chunk of stream) {
        if (capped.signal.aborted) return "";
        if (chunk.type === "text-delta" && chunk.text) out += chunk.text;
      }
    } catch {
      return "";
    } finally {
      clearTimeout(capTimer);
      signal.removeEventListener("abort", forwardAbort);
    }
    return out.trim();
  }
  /** Stream the player line as Fish TTS PCM over SSE (speaker:"player"). */
  async speak(sessionId, utteranceId, text, config, signal, emotion, expression) {
    const apiKeys = this.deps.resolveKeys(this.deps.getConfig());
    const voiceId = config.playerVoiceId || config.voiceId;
    this.deps.hub.emit(sessionId, "speech-start", { utteranceId, speaker: "player" });
    this.deps.hub.emit(sessionId, "audio-start", { utteranceId, sampleRate: PCM_SAMPLE_RATE, speaker: "player" });
    if (emotion !== void 0 && expression !== void 0) {
      this.deps.hub.emit(sessionId, "expression", { utteranceId, emotion, expression, speaker: "player" });
    }
    const { motions } = extractMotionTags(text);
    for (const motion of motions) {
      this.deps.hub.emit(sessionId, "motion", { utteranceId, motion, speaker: "player" });
    }
    if (apiKeys.length === 0) {
      this.emitSubtitle(sessionId, utteranceId, text);
      this.settleSpeech(sessionId, utteranceId, "finish");
      return;
    }
    let subtitled = false;
    let seq = 0;
    const emitSubtitleOnce = (audioSeq) => {
      if (subtitled) return;
      subtitled = true;
      this.emitSubtitle(sessionId, utteranceId, text, audioSeq);
    };
    try {
      await synthesize({ text, voiceId, model: config.ttsModel, apiKeys, signal }, (pcm) => {
        if (signal.aborted) return;
        emitSubtitleOnce(seq);
        this.deps.hub.emit(sessionId, "audio", {
          utteranceId,
          seq: seq++,
          b64: pcm.toString("base64"),
          speaker: "player"
        });
      });
    } catch (error) {
      if (!signal.aborted) {
        this.deps.hub.emit(sessionId, "error", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      emitSubtitleOnce();
      this.settleSpeech(sessionId, utteranceId, signal.aborted ? "aborted" : "finish");
    }
  }
  emitSubtitle(sessionId, utteranceId, text, audioSeq) {
    this.deps.hub.emit(sessionId, "subtitle", {
      role: "user",
      text,
      utteranceId,
      lineId: `${utteranceId}-1`,
      ...audioSeq !== void 0 ? { audioSeq } : {},
      speaker: "player"
    });
  }
  settleSpeech(sessionId, utteranceId, reason) {
    this.deps.hub.emit(sessionId, "audio-end", { utteranceId, speaker: "player" });
    this.deps.hub.emit(sessionId, "speech-end", { utteranceId, reason, speaker: "player" });
  }
  /** The session's current conversation model (polish reuses it). */
  async resolveSessionModel(sessionId) {
    try {
      const agent = await this.resolveAgent(sessionId);
      const header = agent?.session?.requestHeader?.();
      if (header?.config) {
        return {
          provider: header.config.provider,
          model: header.config.model,
          ...typeof header.config.reasoningEffort === "string" && header.config.reasoningEffort ? { reasoningEffort: header.config.reasoningEffort } : {}
        };
      }
      const catalog = await this.ctx.sessionController.modelCatalog();
      if (catalog?.default) return { provider: catalog.default.provider, model: catalog.default.model };
    } catch {
    }
    return void 0;
  }
  /** Resolve the live agent, cold-resuming the session like /message does. */
  async resolveAgent(sessionId) {
    const existing = this.ctx.agents.get(sessionId);
    if (existing !== void 0) return existing;
    const found = await this.ctx.sessionController.resolveAgent(sessionId);
    if (found !== void 0 && "agent" in found && found.agent !== void 0) return found.agent;
    const detail = found !== void 0 && "error" in found ? String(found.error?.message ?? "session not found") : "session not found";
    throw new Error(detail);
  }
  async submitToAgent(sessionId, text, mode) {
    try {
      const agent = await this.resolveAgent(sessionId);
      if (agent === void 0) throw new Error("session not found");
      const content = [{ type: "text", text }];
      const message = createUserMessage3({ content, source: { kind: "user" } });
      if (mode === "steer") agent.steer(message);
      else agent.followup(message);
    } catch (error) {
      this.deps.hub.emit(sessionId, "error", {
        message: `\u6D88\u606F\u63D0\u4EA4\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
};

// src/index.ts
var name = "dsh-live2d-voice";
var inject = ["agents", "llm", "attachments", "sessionController"];
function apply(ctx) {
  const hub = new SseHub();
  const modes = new SpeechModes();
  const getConfig = loadConfig;
  const supersedeAssistant = applySpeechTap(ctx, {
    hub,
    modes,
    getConfig,
    resolveKeys: resolveApiKeys,
    resolveSession: (sessionId) => resolveSessionConfig2(ctx.agents, getConfig(), sessionId)
  });
  const disposePrompt = applySpeechInjection(ctx, {
    hub,
    modes,
    getConfig,
    resolveSession: (sessionId) => resolveSessionConfig2(ctx.agents, getConfig(), sessionId)
  });
  const disposeSlim = applyContextSlim(ctx, {
    hub,
    getConfig,
    resolveSession: (sessionId) => resolveSessionConfig2(ctx.agents, getConfig(), sessionId)
  });
  const playerPipeline = new PlayerPipeline(ctx, {
    hub,
    getConfig,
    resolveKeys: resolveApiKeys,
    resolveSession: (sessionId) => resolveSessionConfig2(ctx.agents, getConfig(), sessionId),
    supersedeAssistant
  });
  const cameraBridge = new CameraBridge(hub);
  const disposeCameraTool = applyCameraTool(ctx, hub, cameraBridge);
  const disposeRoutes = installRoutes(ctx, { hub, getConfig, resolveKeys: resolveApiKeys, saveConfig, cameraBridge, playerPipeline });
  ctx.logger.info("dsh-live2d-voice: loaded (config: " + loadConfig().voiceId.slice(0, 8) + "\u2026 voice)");
  return () => {
    disposeRoutes?.();
    disposeCameraTool();
    playerPipeline.dispose();
    disposePrompt?.();
    disposeSlim();
  };
}
export {
  apply,
  inject,
  name
};
