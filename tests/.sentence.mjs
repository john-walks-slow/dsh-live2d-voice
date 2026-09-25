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
export {
  SentenceBuffer,
  extractEmotionTags,
  extractMotionTags,
  splitByWeight
};
