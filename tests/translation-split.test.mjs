/**
 * Deterministic unit tests for the whole-utterance translation split
 * (splitByWeight in sentence.ts — used by the speech tap to spread one
 * translated utterance back onto its per-line subtitles).
 *
 * Run: node --test tests/translation-split.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".sentence.mjs");
execFileSync(
	"npx",
	["esbuild", join(here, "..", "src", "sentence.ts"), "--bundle", "--format=esm", `--outfile=${out}`],
	{ stdio: "ignore" },
);
const { splitByWeight } = await import(`${out}?t=${Date.now()}`);

test("single line receives the whole translation", () => {
	assert.deepEqual(splitByWeight("是的，今天天气很好。", [12]), ["是的，今天天气很好。"]);
});

test("equal weights split into clause-aligned pieces", () => {
	const pieces = splitByWeight("好的，今天天气真不错，我们一起去公园散步吧，然后回家吃饭。", [15, 15, 15]);
	assert.equal(pieces.length, 3);
	assert.ok(pieces.every((p) => p.length > 0), `every line covered: ${JSON.stringify(pieces)}`);
	assert.equal(pieces[0], "好的，今天天气真不错，");
	assert.equal(pieces[1], "我们一起去公园散步吧，");
	assert.equal(pieces[2], "然后回家吃饭。");
});

test("user repro: one short translated sentence still covers every line", () => {
	// Three original lines, translation collapses to a single short sentence —
	// the old index mapping piled everything onto line 1 and left 2/3 bare.
	const pieces = splitByWeight("是的，是这样的，我明白了", [2, 4, 6]);
	assert.equal(pieces.length, 3);
	assert.ok(pieces.every((p) => p.length > 0), `every line covered: ${JSON.stringify(pieces)}`);
	assert.equal(pieces.join(""), "是的，是这样的，我明白了");
});

test("unequal weights lean toward the heavier line", () => {
	const pieces = splitByWeight("这句话很长很长，而尾巴很短。", [20, 5]);
	assert.equal(pieces.length, 2);
	assert.ok(pieces.every((p) => p.length > 0));
	assert.ok(pieces[0].length >= pieces[1].length, `heavier line first: ${JSON.stringify(pieces)}`);
});

test("translation shorter than the line count still yields non-empty head pieces", () => {
	const pieces = splitByWeight("好的。", [5, 5, 5]);
	assert.equal(pieces.length, 3);
	assert.ok(pieces[0] && pieces[1] && pieces[2], `all pieces non-empty: ${JSON.stringify(pieces)}`);
	assert.equal(pieces.join(""), "好的。");
});

test("no punctuation nearby — the raw proportional cut stands", () => {
	assert.deepEqual(splitByWeight("abcdefghij", [5, 5]), ["abcde", "fghij"]);
});

test("empty translation / empty weights edge cases", () => {
	assert.deepEqual(splitByWeight("", [3, 3]), ["", ""]);
	assert.deepEqual(splitByWeight("文本", [0, 0]), ["文本", ""]);
	assert.deepEqual(splitByWeight("文本", []), []);
});

test("pieces always concatenate back to the original translation", () => {
	const translated = "这是一个比较长的翻译结果，包含多个子句、逗号。第二句在这里！最后还有一个短句。";
	const weights = [4, 9, 2, 14, 7];
	const pieces = splitByWeight(translated, weights);
	assert.equal(pieces.length, weights.length);
	assert.equal(pieces.join(""), translated);
});
