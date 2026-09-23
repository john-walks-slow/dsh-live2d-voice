#!/usr/bin/env node
/**
 * Phase 2 ASR module smoke: compiles src/asr.ts standalone and exercises
 * recognizeUtterance against the real Volcengine endpoint.
 *
 * Checks: ja+auto / zh+auto / ja explicit / empty pcm / short pcm probe /
 * parallel isolation / language-code mapping. Exits non-zero on failure.
 *
 * Env: ASR_PCM_JA / ASR_PCM_ZH (default /tmp/t-ja-16k.pcm, /tmp/t-zh-16k.pcm),
 *      ASR_CREDENTIALS (default ~/.config/volc-asr/credentials.json).
 *
 * Test PCM regeneration (fish-tts, see the fish-audio skill):
 *   1. Synthesize 「你好，今天天气真不错，我们一起去公园散步吧。」 → wav
 *   2. Downmix to 16k s16le mono: ffmpeg -i in.wav -ar 16000 -ac 1 -f s16le -acodec pcm_s16le t-zh-16k.pcm
 *   (ja likewise with 「こんにちは、今日もいい天気ですね。」)
 */
// Standalone smoke for the rewritten per-utterance recognizeUtterance().
import { build } from '/root/plugins/dsh-live2d-voice/node_modules/esbuild/lib/main.js';
import { readFileSync } from 'node:fs';
await build({
  entryPoints: ['/root/plugins/dsh-live2d-voice/src/asr.ts'],
  bundle: true, format: 'esm', platform: 'node', target: 'node22',
  external: ['ws'],
  outfile: '/tmp/lv-asr-test/lv-asr-module.mjs',
});
const { recognizeUtterance, loadVolcCredentials, asrLanguageCode } = await import('/tmp/lv-asr-test/lv-asr-module.mjs');
const creds = loadVolcCredentials(process.env.ASR_CREDENTIALS ?? '/root/.config/volc-asr/credentials.json');
if (!creds) { console.error('✗ no credentials'); process.exit(1); }
console.log('credentials: apikey?', Boolean(creds.apikey), 'legacy?', Boolean(creds.appid && creds.accessToken));

const ja = readFileSync(process.env.ASR_PCM_JA ?? '/tmp/t-ja-16k.pcm');
const zh = readFileSync(process.env.ASR_PCM_ZH ?? '/tmp/t-zh-16k.pcm');
let failures = 0;
const expect = (label, text, includes) => {
  const ok = text.includes(includes);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}: "${text}"`);
};

// 1. ja + auto
{
  const t0 = Date.now();
  const text = await recognizeUtterance(creds, ja, 'auto');
  expect(`ja+auto (${Date.now() - t0}ms)`, text, 'こんにちは');
}
// 2. zh + auto
{
  const t0 = Date.now();
  const text = await recognizeUtterance(creds, zh, 'auto');
  expect(`zh+auto (${Date.now() - t0}ms)`, text, '公园散步');
}
// 3. ja explicit
{
  const text = await recognizeUtterance(creds, ja, 'ja');
  expect('ja+explicit', text, 'いい天気');
}
// 4. empty pcm
{
  const text = await recognizeUtterance(creds, Buffer.alloc(0), 'auto');
  console.log(`${text === '' ? '✓' : '✗'} empty pcm → ""`);
  if (text !== '') failures++;
}
// 5. too-short pcm (< 100ms) — server behavior probe (not via HTTP route)
{
  const text = await recognizeUtterance(creds, ja.subarray(0, 1600), 'auto');
  console.log(`· short pcm (50ms) → "${text}" (informational)`);
}
// 6. parallel isolation
{
  const [a, b] = await Promise.all([
    recognizeUtterance(creds, ja, 'ja'),
    recognizeUtterance(creds, zh, 'zh'),
  ]);
  expect('parallel ja', a, 'こんにちは');
  expect('parallel zh', b, '公园散步');
}
// 7. language code mapping sanity
console.log('langmap:', JSON.stringify({ ja: asrLanguageCode('ja'), zh: asrLanguageCode('zh'), en: asrLanguageCode('en'), xx: asrLanguageCode('xx') }));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
