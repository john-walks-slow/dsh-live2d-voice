// src/client/behavior.ts
var DEFAULT_BEHAVIOR_TUNING = {
  eyeContactMinMs: 500,
  eyeContactMaxMs: 3e3,
  aversionMinMs: 300,
  aversionMaxMs: 1500,
  speakLookRatio: 0.55,
  listenLookRatio: 0.85,
  thinkAversionRatio: 0.75,
  liveliness: 1,
  saccadeScale: 1,
  microSaccadeAmp: 0.03,
  nodEverySec: 9,
  headTiltProb: 0.3,
  bodySwayPeriodMs: 5200,
  aversionTurnDeg: 4
};
var BEHAVIOR_TUNING_KEY = "lv2d.behavior_tuning";
function loadBehaviorTuning() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_BEHAVIOR_TUNING };
    const raw = window.localStorage.getItem(BEHAVIOR_TUNING_KEY);
    if (!raw) return { ...DEFAULT_BEHAVIOR_TUNING };
    return { ...DEFAULT_BEHAVIOR_TUNING, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_BEHAVIOR_TUNING };
  }
}
function saveBehaviorTuning(tuning) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(BEHAVIOR_TUNING_KEY, JSON.stringify(tuning));
  } catch {
  }
}
var SACCADE_DIST = {
  steps: [
    [0.075, 800],
    [0.11, 1200],
    [0.125, 1600],
    [0.14, 2e3],
    [0.125, 2400],
    [0.05, 2800],
    [0.04, 3200],
    [0.03, 3600],
    [0.02, 4e3]
  ],
  tailMs: 4400
};
var TURN_REF_DEG = 5;
var BehaviorController = class {
  tuning;
  rng;
  state = "rest";
  stateUntil = 0;
  /** Script steps queued (sequence layer); drained one per dwell. */
  script = [];
  wanderTarget = { x: 0.5, y: 0.45 };
  aversionPoint = { x: 0.25, y: 0.75 };
  scanFrom = { x: 0.15, y: 0.4 };
  scanTo = { x: 0.85, y: 0.4 };
  scanStart = 0;
  scanDuration = 1500;
  nextSaccadeAt = 0;
  microOffset = { x: 0, y: 0 };
  nodActiveUntil = 0;
  nodStart = 0;
  tiltTarget = 0;
  tiltCur = 0;
  tiltUntil = 0;
  bodyPhase = 0;
  nextNodAt = 0;
  nextScanAt = 0;
  /** How long the current state has already run (for ratio math). */
  stateDuration = 0;
  lastNow = 0;
  constructor(tuning = {}, rng = Math.random) {
    this.tuning = { ...DEFAULT_BEHAVIOR_TUNING, ...tuning };
    this.rng = rng;
  }
  setTuning(patch) {
    this.tuning = { ...this.tuning, ...patch };
  }
  get currentState() {
    return this.state;
  }
  pick(arr) {
    return arr[Math.min(arr.length - 1, Math.floor(this.rng() * arr.length))];
  }
  range(min, max) {
    return min + this.rng() * (max - min);
  }
  /** liveliness 总乘子：>1 节奏更快（驻留/扫视间隔缩短），<1 更缓。 */
  lively(ms) {
    return Math.max(40, ms / this.tuning.liveliness);
  }
  saccadeIntervalMs() {
    const u = this.rng();
    let acc = 0;
    for (const [prob, ms] of SACCADE_DIST.steps) {
      acc += prob;
      if (u < acc) return this.lively(ms * this.tuning.saccadeScale);
    }
    return this.lively((SACCADE_DIST.tailMs + this.rng() * 1600) * this.tuning.saccadeScale);
  }
  /** A random aversion point, weighted toward "thinking" (up/down) vs social (side). */
  pickAversionPoint() {
    const j = () => this.rng() * 0.12 - 0.06;
    const side = this.pick([
      { x: 0.22 + j(), y: 0.72 + j() },
      // 左下
      { x: 0.78 + j(), y: 0.72 + j() },
      // 右下
      { x: 0.45 + j(), y: 0.2 + j() },
      // 上方（思考）
      { x: 0.12 + j(), y: 0.45 + j() },
      // 左
      { x: 0.88 + j(), y: 0.45 + j() }
      // 右
    ]);
    return { x: Math.max(0.05, Math.min(0.95, side.x)), y: Math.max(0.05, Math.min(0.95, side.y)) };
  }
  pickWanderTarget() {
    return {
      x: 0.15 + this.rng() * 0.7,
      y: 0.15 + this.rng() * 0.7
    };
  }
  /** Start a named behavior script (the sequence layer) — first step applies immediately. */
  playScript(now, steps) {
    const first = steps[0];
    this.script = steps.slice(1);
    this.setState(first.state, first.dwellMs, now);
    if (first.state === "wander") this.wanderTarget = this.pickWanderTarget();
    if (first.state === "aversion") this.aversionPoint = this.pickAversionPoint();
    if (first.state === "scan") this.startScan(now);
    if (first.nod !== void 0) this.queueNod(now, first.nod);
  }
  /** Advance to the next script step when the current dwell expires. */
  advanceScript(now) {
    if (now < this.stateUntil) return;
    const step = this.script.shift();
    if (!step) return;
    this.setState(step.state, step.dwellMs, now);
    if (step.state === "wander") this.wanderTarget = this.pickWanderTarget();
    if (step.state === "aversion") this.aversionPoint = this.pickAversionPoint();
    if (step.state === "scan") this.startScan(now);
    if (step.nod !== void 0) this.queueNod(now, step.nod);
  }
  setState(state, dwellMs, now) {
    this.state = state;
    this.stateDuration = 0;
    this.stateUntil = now + dwellMs;
  }
  /**
   * Decide the next state when the current dwell expires (stochastic +
   * context). Gaze states alternate: eye-contact is never chosen twice in a
   * row (a chained mutual gaze would exceed the ~3s "staring" ceiling —
   * research anchor), aversion chains are allowed only while thinking
   * (repeated looking-away is natural when lost in thought).
   */
  pickNextState(now, input) {
    const t = this.tuning;
    const prev = this.state;
    const noFace = input.face === null;
    let contact = t.eyeContactMinMs;
    let aversion = t.aversionMaxMs;
    let allowAversionChain = false;
    if (input.thinking && !noFace) {
      contact = this.range(400, 900);
      aversion = this.range(t.aversionMinMs, t.aversionMaxMs);
      allowAversionChain = true;
    } else if (input.userSpeaking && !noFace) {
      contact = this.range(t.eyeContactMinMs, Math.min(t.eyeContactMaxMs, 2600));
      aversion = Math.max(250, Math.min(t.aversionMaxMs, contact * (1 - t.listenLookRatio) / Math.max(0.05, t.listenLookRatio)));
    } else if (input.speaking && !noFace) {
      contact = this.range(t.eyeContactMinMs, t.eyeContactMaxMs);
      aversion = Math.max(t.aversionMinMs, Math.min(t.aversionMaxMs, contact * (1 - t.speakLookRatio) / Math.max(0.05, t.speakLookRatio)));
    } else if (!noFace) {
      contact = this.range(Math.min(500, t.eyeContactMaxMs), Math.min(2200, t.eyeContactMaxMs));
      aversion = Math.min(t.aversionMaxMs, contact * 0.43);
    } else if (now >= this.nextScanAt) {
      this.startScan(now);
      this.nextScanAt = now + this.range(1e4, 2e4);
      return;
    } else if (prev === "wander") {
      this.setState("rest", this.range(2e3, 6e3), now);
      return;
    } else if (prev === "rest" || prev === "scan") {
      this.setState("wander", this.range(800, 2600), now);
      this.wanderTarget = this.pickWanderTarget();
      return;
    } else {
      this.setState("wander", this.range(800, 2600), now);
      this.wanderTarget = this.pickWanderTarget();
      return;
    }
    const curious = !noFace && !input.userLooking && !input.thinking && !input.userSpeaking && !input.speaking;
    if (curious) {
      if (prev !== "eye-contact" && this.rng() < 0.25) {
        this.setState("eye-contact", this.range(400, 900), now);
        return;
      }
      this.setState(prev === "wander" ? "rest" : "wander", this.range(400, 2400), now);
      if (this.state === "wander") this.wanderTarget = this.pickWanderTarget();
      return;
    }
    if (prev === "eye-contact") {
      this.setState("aversion", this.lively(aversion), now);
      this.aversionPoint = this.pickAversionPoint();
      return;
    }
    if (prev === "aversion" && !allowAversionChain) {
      this.setState("eye-contact", this.lively(contact), now);
      return;
    }
    if (this.rng() < (input.thinking ? t.thinkAversionRatio : 0.7)) {
      this.setState("aversion", this.lively(aversion), now);
      this.aversionPoint = this.pickAversionPoint();
    } else {
      this.setState("eye-contact", this.lively(contact), now);
    }
  }
  startScan(now) {
    const vertical = this.rng() < 0.3;
    const y0 = 0.25 + this.rng() * 0.2;
    this.scanFrom = vertical ? { x: 0.5, y: 0.15 } : { x: 0.12, y: y0 };
    this.scanTo = vertical ? { x: 0.5, y: 0.85 } : { x: 0.88, y: y0 };
    this.scanStart = now;
    this.scanDuration = this.range(1200, 2400);
    this.stateDuration = 0;
    this.stateUntil = now + this.scanDuration;
  }
  queueNod(now, envelope = 1) {
    this.nodStart = now;
    this.nodActiveUntil = now + 380 * envelope;
  }
  easeInOut(u) {
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }
  /** Advance one frame. Call from rAF with the current input. */
  update(input, now) {
    const t = this.tuning;
    const dt = this.lastNow > 0 ? Math.max(0, Math.min(250, now - this.lastNow)) : 16;
    this.lastNow = now;
    this.stateDuration += dt;
    if (input.userLookRising) {
      this.playScript(now, [
        { state: "eye-contact", dwellMs: 1500 },
        { state: "aversion", dwellMs: 400 },
        { state: "eye-contact", dwellMs: 2e3 }
      ]);
    } else if (input.speechStart) {
      this.playScript(now, [
        { state: "aversion", dwellMs: 650 },
        { state: "eye-contact", dwellMs: 900 }
      ]);
    } else if (input.sentenceBoundary && input.speaking) {
      this.playScript(now, [{ state: "eye-contact", dwellMs: 800, nod: 1 }]);
    } else if (this.script.length > 0) {
      this.advanceScript(now);
    } else if (now >= this.stateUntil) {
      this.pickNextState(now, input);
    }
    let x, y;
    switch (this.state) {
      case "eye-contact":
        x = input.face?.x ?? 0.5;
        y = input.face?.y ?? 0.5;
        break;
      case "aversion":
        x = this.aversionPoint.x;
        y = this.aversionPoint.y;
        break;
      case "wander":
        x = this.wanderTarget.x;
        y = this.wanderTarget.y;
        break;
      case "scan": {
        const u = this.easeInOut(Math.max(0, Math.min(1, (now - this.scanStart) / this.scanDuration)));
        x = this.scanFrom.x + (this.scanTo.x - this.scanFrom.x) * u;
        y = this.scanFrom.y + (this.scanTo.y - this.scanFrom.y) * u;
        break;
      }
      case "thinking":
        x = this.aversionPoint.x;
        y = this.aversionPoint.y;
        break;
      default:
        x = 0.5;
        y = 0.52;
    }
    if (now >= this.nextSaccadeAt) {
      this.nextSaccadeAt = now + this.saccadeIntervalMs();
      const amp = t.microSaccadeAmp * (0.5 + this.rng() * 1.5);
      this.microOffset = {
        x: (this.rng() * 2 - 1) * amp,
        y: (this.rng() * 2 - 1) * amp
      };
    }
    if (this.state === "eye-contact" || this.state === "rest") {
      x += this.microOffset.x;
      y += this.microOffset.y;
    }
    let nod = 0;
    if (now < this.nodActiveUntil) {
      const u = (now - this.nodStart) / Math.max(1, this.nodActiveUntil - this.nodStart);
      nod = Math.sin(Math.PI * Math.min(1, u));
    } else if (input.userSpeaking && now >= this.nextNodAt && t.nodEverySec > 0) {
      this.queueNod(now, 1);
      this.nextNodAt = now + t.nodEverySec * 1e3 * (0.7 + this.rng() * 0.8);
    }
    if (now >= this.tiltUntil) {
      if (this.state === "thinking" && this.rng() < t.headTiltProb) {
        this.tiltTarget = this.rng() < 0.5 ? 1 : -1;
        this.tiltUntil = now + this.range(800, 2400);
      } else if (input.userSpeaking && this.rng() < 0.15) {
        this.tiltTarget = this.rng() < 0.5 ? 0.6 : -0.6;
        this.tiltUntil = now + this.range(900, 2e3);
      } else {
        this.tiltTarget = 0;
        this.tiltUntil = now + 400;
      }
    }
    this.tiltCur += (this.tiltTarget - this.tiltCur) * 0.12;
    this.bodyPhase = (this.bodyPhase + 2 * Math.PI * dt / t.bodySwayPeriodMs) % (2 * Math.PI);
    const bodySway = Math.sin(this.bodyPhase);
    const faceX = input.face?.x ?? 0.5;
    const gazeOffset = Math.max(-1, Math.min(1, (x - faceX) * 2));
    const turnGain = t.aversionTurnDeg / TURN_REF_DEG;
    let turn = 0;
    if (this.state === "aversion") {
      turn = Math.max(-1, Math.min(1, (x - 0.5) * 2)) * 0.8 * turnGain;
    } else if (this.state === "wander" || this.state === "scan") {
      turn = gazeOffset * 0.4 * turnGain;
    }
    return {
      x: Math.max(0.02, Math.min(0.98, x)),
      y: Math.max(0.02, Math.min(0.98, y)),
      nod,
      tilt: this.tiltCur,
      turn,
      bodySway,
      state: this.state
    };
  }
};
export {
  BEHAVIOR_TUNING_KEY,
  BehaviorController,
  DEFAULT_BEHAVIOR_TUNING,
  loadBehaviorTuning,
  saveBehaviorTuning
};
