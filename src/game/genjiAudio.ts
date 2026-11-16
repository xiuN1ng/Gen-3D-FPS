/**
 * 100% Procedural Web Audio Synthesizer for Genji's Cyber-Shinobi kit.
 * Zero external audio files (.mp3/.wav/.ogg).
 */

export interface GenjiAudioController {
  resume: () => void;
  setVolume: (vol: number) => void;
  shurikenThrow: (fan?: boolean) => void;
  shurikenReload: () => void;
  doubleJump: () => void;
  wallClimbStep: () => void;
  meleeSlash: () => void;
  swiftStrike: () => void;
  swiftReset: () => void;
  deflectStart: () => void;
  deflectParry: () => void;
  dragonbladeCast: () => void;
  dragonSlash: (heavyWave?: boolean) => void;
  bladeCleaveImpact: (isKill?: boolean) => void;
  structureBreak: (isCollapse?: boolean) => void;
  upgradePick: () => void;
  waveBanner: (isBoss?: boolean) => void;
  katanaSheathe: () => void;
  colossusRoar: () => void;
  colossusSlam: () => void;
  orbShatter: () => void;
  pulseRifleShot: (visorLock?: boolean) => void;
  helixLaunch: () => void;
  helixExplode: () => void;
  bioticDeploy: () => void;
  visorCast: () => void;
  shieldRicochet: () => void;
  bulletHitConfirm: (isCrit?: boolean) => void;
  bowDrawStart: () => void;
  bowRelease: (chargeRatio?: number, isStorm?: boolean) => void;
  stormArrowsCast: () => void;
  stormRicochet: () => void;
  sonicArrowPulse: () => void;
  hanzoLunge: () => void;
  dragonstrikeCast: () => void;
}

export function createGenjiAudio(noAudio = false): GenjiAudioController {
  const noop = () => {};
  if (noAudio || typeof window === 'undefined') {
    return {
      resume: noop,
      setVolume: noop,
      shurikenThrow: noop,
      shurikenReload: noop,
      doubleJump: noop,
      wallClimbStep: noop,
      meleeSlash: noop,
      swiftStrike: noop,
      swiftReset: noop,
      deflectStart: noop,
      deflectParry: noop,
      dragonbladeCast: noop,
      dragonSlash: noop,
      bladeCleaveImpact: noop,
      structureBreak: noop,
      upgradePick: noop,
      waveBanner: noop,
      katanaSheathe: noop,
      colossusRoar: noop,
      colossusSlam: noop,
      orbShatter: noop,
      pulseRifleShot: noop,
      helixLaunch: noop,
      helixExplode: noop,
      bioticDeploy: noop,
      visorCast: noop,
      shieldRicochet: noop,
      bulletHitConfirm: noop,
      bowDrawStart: noop,
      bowRelease: noop,
      stormArrowsCast: noop,
      stormRicochet: noop,
      sonicArrowPulse: noop,
      hanzoLunge: noop,
      dragonstrikeCast: noop,
    };
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let volume = 0.85;

  const ensureCtx = (): AudioContext | null => {
    if (!AudioCtx) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtx({ latencyHint: 'interactive' });
        master = ctx.createGain();
        master.gain.value = volume * 0.8;
        master.connect(ctx.destination);

        const len = Math.floor(ctx.sampleRate * 1.5);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          ch[i] = Math.random() * 2 - 1;
        }
      } catch {
        ctx = null;
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  const playNoise = (
    c: AudioContext,
    dur: number,
    filterType: BiquadFilterType,
    fStart: number,
    fEnd: number,
    q: number,
    gainPeak: number,
    delay = 0
  ) => {
    if (!noiseBuf || !master) return;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    const flt = c.createBiquadFilter();
    flt.type = filterType;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(Math.max(40, fStart), t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t0 + dur);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + Math.min(0.015, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(flt);
    flt.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  };

  const playTone = (
    c: AudioContext,
    type: OscillatorType,
    fStart: number,
    fEnd: number,
    dur: number,
    gainPeak: number,
    delay = 0
  ) => {
    if (!master) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, fStart), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t0 + dur);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  return {
    resume() {
      ensureCtx();
    },
    setVolume(vol: number) {
      volume = Math.max(0, Math.min(1, vol));
      if (master && ctx) {
        master.gain.setTargetAtTime(volume * 0.8, ctx.currentTime, 0.03);
      }
    },
    shurikenThrow(fan = false) {
      const c = ensureCtx();
      if (!c) return;
      const jitter = 0.94 + Math.random() * 0.12;
      playTone(c, 'triangle', 2750 * jitter, 4400 * jitter, fan ? 0.11 : 0.085, fan ? 0.2 : 0.15);
      playTone(c, 'sine', 5400 * jitter, 3100 * jitter, 0.07, 0.10);
      playNoise(c, fan ? 0.12 : 0.08, 'bandpass', 2400 * jitter, 6200 * jitter, 2.2, fan ? 0.26 : 0.18);
    },
    shurikenReload() {
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.12, 'bandpass', 900, 2400, 3.0, 0.14, 0);
      playTone(c, 'triangle', 620, 1180, 0.14, 0.10, 0.04);
      playTone(c, 'triangle', 1320, 1980, 0.14, 0.13, 0.36);
      playTone(c, 'sine', 980, 2240, 0.22, 0.14, 0.56);
    },
    doubleJump() {
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.17, 'bandpass', 620, 3100, 1.3, 0.24);
      playTone(c, 'sine', 250, 620, 0.14, 0.15);
    },
    wallClimbStep() {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.16;
      playNoise(c, 0.075, 'bandpass', 420 * j, 1300 * j, 1.8, 0.15);
      playTone(c, 'triangle', 170 * j, 95 * j, 0.06, 0.11);
    },
    meleeSlash() {
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.16, 'bandpass', 1100, 4600, 1.5, 0.28);
      playTone(c, 'sawtooth', 1480, 580, 0.14, 0.13);
    },
    swiftStrike() {
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 165, 40, 0.24, 0.38);
      playNoise(c, 0.25, 'bandpass', 1400, 6800, 1.4, 0.36);
      playTone(c, 'sawtooth', 1850, 3900, 0.19, 0.17);
      playTone(c, 'sine', 3100, 1480, 0.24, 0.14, 0.04);
    },
    swiftReset() {
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 1318.5, 1318.5, 0.12, 0.16, 0);
      playTone(c, 'triangle', 1975.5, 2637, 0.19, 0.18, 0.045);
    },
    deflectStart() {
      const c = ensureCtx();
      if (!c) return;
      // Dual katana/wakizashi unsheathe & rapid figure-8 blade weave!
      playTone(c, 'sawtooth', 1680, 4600, 0.24, 0.18);
      playTone(c, 'triangle', 2600, 4800, 0.28, 0.15, 0.06);
      playNoise(c, 0.28, 'highpass', 2600, 6200, 2.2, 0.20);
    },
    deflectParry() {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.18;
      // Loud, unmistakable multi-harmonic forged Katana Bullet-Parry Ring (`锵——！`)
      playTone(c, 'triangle', 1840 * j, 1680 * j, 0.24, 0.34);
      playTone(c, 'sine', 3420 * j, 3120 * j, 0.28, 0.26);
      playTone(c, 'sine', 5280 * j, 4640 * j, 0.22, 0.18);
      playTone(c, 'sine', 145, 52, 0.10, 0.24);
      playNoise(c, 0.085, 'highpass', 3200, 7800, 2.8, 0.28);
    },
    dragonbladeCast() {
      const c = ensureCtx();
      if (!c) return;
      // 1. Thunderous Japanese O-Daiko war-drum strike
      playTone(c, 'sine', 132, 34, 0.58, 0.48, 0);
      playTone(c, 'sine', 112, 32, 0.48, 0.38, 0.20);
      // 2. Forged Tamahagane Odachi unsheathe ring (`吟龙拔刀鸣`)
      playTone(c, 'sawtooth', 980, 4120, 0.58, 0.24, 0.04);
      playTone(c, 'triangle', 1960, 5100, 0.75, 0.20, 0.07);
      // 3. Twin Spirit-Dragon roaring gale & low harmonic growl
      playNoise(c, 1.35, 'bandpass', 280, 1620, 2.1, 0.40, 0.10);
      playTone(c, 'sawtooth', 165, 310, 0.72, 0.24, 0.12);
      playTone(c, 'sawtooth', 294, 132, 0.92, 0.26, 0.36);
    },
    dragonSlash(heavyWave = false) {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.94 + Math.random() * 0.12;
      playTone(c, 'sine', 155 * j, 44 * j, 0.24, 0.34);
      playNoise(c, 0.28, 'bandpass', 850 * j, 5200 * j, 1.3, 0.36);
      playTone(c, 'sawtooth', 920 * j, 2450 * j, 0.24, 0.22);
      playTone(c, 'triangle', (heavyWave ? 1480 : 1180) * j, 520 * j, 0.34, 0.20, 0.03);
    },
    bladeCleaveImpact(isKill = false) {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.93 + Math.random() * 0.14;
      // Visceral armor-cleaving sub crunch + wet steel slice!
      playTone(c, 'sine', isKill ? 195 : 155, 38, isKill ? 0.22 : 0.15, isKill ? 0.42 : 0.32);
      playTone(c, 'sawtooth', 920 * j, 260 * j, 0.14, 0.22);
      playNoise(c, 0.13, 'bandpass', 1600 * j, 4800 * j, 1.7, 0.28);
    },
    structureBreak(isCollapse = false) {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.9 + Math.random() * 0.2;
      // Splintering hinoki beams + crashing clay kawara roof tiles!
      playNoise(c, isCollapse ? 0.44 : 0.19, 'bandpass', (isCollapse ? 720 : 1200) * j, 210, 1.2, isCollapse ? 0.38 : 0.22);
      playTone(c, 'triangle', (isCollapse ? 130 : 185) * j, 36, isCollapse ? 0.34 : 0.14, isCollapse ? 0.36 : 0.20);
      if (isCollapse) {
        playNoise(c, 0.28, 'highpass', 2400, 5600, 1.8, 0.18, 0.06);
      }
    },
    upgradePick() {
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'triangle', 587.3, 587.3, 0.22, 0.15, 0);
      playTone(c, 'triangle', 698.5, 698.5, 0.24, 0.15, 0.06);
      playTone(c, 'triangle', 880.0, 880.0, 0.28, 0.16, 0.12);
      playTone(c, 'sine', 1174.7, 1174.7, 0.42, 0.17, 0.18);
    },
    waveBanner(isBoss = false) {
      const c = ensureCtx();
      if (!c) return;
      if (isBoss) {
        playTone(c, 'sawtooth', 92.5, 55.0, 0.85, 0.32);
        playTone(c, 'sine', 110, 38, 0.7, 0.40);
        playNoise(c, 0.65, 'lowpass', 600, 180, 2.0, 0.26);
      } else {
        playTone(c, 'sine', 115, 44, 0.42, 0.28);
        playTone(c, 'triangle', 440, 659.25, 0.32, 0.14, 0.06);
      }
    },
    katanaSheathe() {
      const c = ensureCtx();
      if (!c) return;
      // Chiburi air flick -> metallic habaki slide -> crisp koiguchi lock click!
      playNoise(c, 0.09, 'bandpass', 1800, 4200, 2.0, 0.16, 0);
      playTone(c, 'triangle', 2900, 1450, 0.16, 0.12, 0.08);
      playTone(c, 'sine', 1240, 420, 0.065, 0.24, 0.23);
      playNoise(c, 0.045, 'highpass', 2800, 5600, 2.6, 0.20, 0.23);
    },
    colossusRoar() {
      const c = ensureCtx();
      if (!c) return;
      // Earth-shaking Oni-Tengu war horn + thunderous O-Daiko sub + guttural harmonic growl
      playTone(c, 'sine', 96, 28, 0.85, 0.48, 0);
      playTone(c, 'sawtooth', 118, 62, 1.05, 0.28, 0.04);
      playTone(c, 'triangle', 236, 114, 0.92, 0.22, 0.08);
      playNoise(c, 1.0, 'lowpass', 780, 190, 2.4, 0.36, 0.05);
    },
    colossusSlam() {
      const c = ensureCtx();
      if (!c) return;
      // Colossal Odachi tectonic impact + expanding shockwave rumble
      playTone(c, 'sine', 142, 26, 0.62, 0.50, 0);
      playTone(c, 'triangle', 210, 44, 0.45, 0.30, 0.02);
      playNoise(c, 0.55, 'bandpass', 920, 160, 1.4, 0.40, 0);
      playTone(c, 'sawtooth', 680, 240, 0.28, 0.16, 0.03);
    },
    orbShatter() {
      const c = ensureCtx();
      if (!c) return;
      // Crystalline Raijin Taiko weakspot shatter + harmonic bell chime!
      playTone(c, 'sine', 1568, 3136, 0.32, 0.26, 0);
      playTone(c, 'triangle', 2349, 1174, 0.38, 0.22, 0.03);
      playTone(c, 'sine', 180, 42, 0.28, 0.36, 0);
      playNoise(c, 0.22, 'highpass', 3400, 8200, 2.2, 0.30, 0);
    },
    pulseRifleShot(visorLock = false) {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.96 + Math.random() * 0.08;
      // Crisp tactical heavy plasma-ballistic crack + sub-bass chest punch + mechanical bolt snap
      playTone(c, 'sawtooth', (visorLock ? 1140 : 940) * j, 175 * j, 0.072, 0.25);
      playTone(c, 'sine', 210 * j, 46, 0.075, 0.34);
      playTone(c, 'triangle', 2680 * j, 1180 * j, 0.032, 0.14);
      playNoise(c, 0.058, 'bandpass', 2200 * j, 5400 * j, 1.5, 0.25);
      if (visorLock) {
        playTone(c, 'triangle', 2850 * j, 2020 * j, 0.042, 0.13);
      }
    },
    helixLaunch() {
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sawtooth', 320, 960, 0.19, 0.24, 0);
      playTone(c, 'triangle', 480, 1280, 0.18, 0.20, 0.04);
      playNoise(c, 0.24, 'bandpass', 950, 4200, 1.8, 0.32, 0);
    },
    helixExplode() {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.16;
      playTone(c, 'sine', 148 * j, 30, 0.42, 0.48, 0);
      playTone(c, 'sawtooth', 260 * j, 58, 0.28, 0.28, 0.02);
      playNoise(c, 0.38, 'lowpass', 1400 * j, 220, 1.5, 0.40, 0);
    },
    bioticDeploy() {
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 220, 88, 0.16, 0.26, 0);
      playTone(c, 'triangle', 523.25, 1046.5, 0.28, 0.18, 0.05);
      playTone(c, 'sine', 783.99, 1567.98, 0.36, 0.16, 0.11);
    },
    visorCast() {
      const c = ensureCtx();
      if (!c) return;
      // Iconic Tactical Visor rising turbine lock chime!
      playTone(c, 'sawtooth', 280, 1480, 0.38, 0.22, 0);
      playTone(c, 'sine', 880, 1760, 0.24, 0.22, 0.18);
      playTone(c, 'triangle', 1760, 2637, 0.30, 0.24, 0.32);
      playNoise(c, 0.26, 'bandpass', 1600, 5600, 2.4, 0.20, 0.04);
    },
    shieldRicochet() {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.90 + Math.random() * 0.20;
      playTone(c, 'triangle', 2200 * j, 920 * j, 0.12, 0.20);
      playNoise(c, 0.06, 'highpass', 3400, 6800, 2.5, 0.18);
    },
    bulletHitConfirm(isCrit = false) {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.97 + Math.random() * 0.06;
      if (isCrit) {
        // High-clarity metallic headshot critical "dink"!
        playTone(c, 'sine', 2180 * j, 2960 * j, 0.065, 0.22, 0);
        playTone(c, 'triangle', 3320 * j, 2640 * j, 0.055, 0.16, 0.01);
      } else {
        // Crisp tactile body-hit marker tick
        playTone(c, 'triangle', 1420 * j, 860 * j, 0.036, 0.15, 0);
        playNoise(c, 0.024, 'highpass', 2600, 5200, 1.8, 0.11, 0);
      }
    },
    bowDrawStart() {
      const c = ensureCtx();
      if (!c) return;
      // Taut laminated bamboo-carbon Kyudo string creak & rising tension hum
      playNoise(c, 0.14, 'bandpass', 540, 1380, 3.2, 0.12, 0);
      playTone(c, 'triangle', 190, 360, 0.22, 0.10, 0.01);
    },
    bowRelease(chargeRatio = 1, isStorm = false) {
      const c = ensureCtx();
      if (!c) return;
      const p = Math.max(0.2, Math.min(1, chargeRatio));
      const j = 0.95 + Math.random() * 0.10;
      if (isStorm) {
        // Electric Storm Arrow crack + ultrasonic string snap!
        playTone(c, 'sawtooth', 1640 * j, 520 * j, 0.10, 0.24, 0);
        playTone(c, 'sine', 2680 * j, 1240 * j, 0.09, 0.20, 0.01);
        playNoise(c, 0.085, 'bandpass', 2200, 6400, 1.8, 0.24, 0);
      } else {
        // Deep Kyudo Tsurune (`弦音`) harmonic twang + feathered arrow whoosh!
        playTone(c, 'triangle', (320 + p * 260) * j, 135 * j, 0.18 + p * 0.08, 0.18 + p * 0.14, 0);
        playTone(c, 'sine', (1180 + p * 840) * j, 620 * j, 0.11, 0.12 + p * 0.10, 0);
        playNoise(c, 0.10 + p * 0.06, 'bandpass', 1400, 4800 + p * 1800, 1.7, 0.16 + p * 0.14, 0);
      }
    },
    stormArrowsCast() {
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 440, 1320, 0.24, 0.22, 0);
      playTone(c, 'triangle', 880, 2200, 0.28, 0.20, 0.05);
      playNoise(c, 0.22, 'highpass', 2400, 6800, 2.2, 0.20, 0);
    },
    stormRicochet() {
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.16;
      playTone(c, 'sine', 2480 * j, 3720 * j, 0.10, 0.18, 0);
      playNoise(c, 0.05, 'highpass', 3600, 7600, 2.6, 0.15, 0);
    },
    sonicArrowPulse() {
      const c = ensureCtx();
      if (!c) return;
      // Crystalline Sonic Arrow sonar recon ping (`叮——嗡`)!
      playTone(c, 'sine', 1567.98, 1567.98, 0.34, 0.22, 0);
      playTone(c, 'triangle', 2349.32, 1975.53, 0.42, 0.16, 0.04);
      playTone(c, 'sine', 392.0, 196.0, 0.38, 0.18, 0.02);
    },
    hanzoLunge() {
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.18, 'bandpass', 780, 3800, 1.5, 0.26, 0);
      playTone(c, 'sine', 310, 780, 0.16, 0.18, 0);
    },
    dragonstrikeCast() {
      const c = ensureCtx();
      if (!c) return;
      // "Ryuuga wagateki wo kurau!" — Taiko thunder + twin roaring azure spirit dragons!
      playTone(c, 'sine', 124, 30, 0.72, 0.50, 0);
      playTone(c, 'sine', 98, 28, 0.65, 0.42, 0.22);
      playTone(c, 'sawtooth', 196, 392, 0.85, 0.26, 0.08);
      playTone(c, 'triangle', 587.33, 293.66, 1.15, 0.24, 0.28);
      playNoise(c, 1.65, 'bandpass', 260, 1840, 1.9, 0.42, 0.10);
    },
  };
}


