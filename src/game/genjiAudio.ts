/**
 * 100% Procedural Web Audio Synthesizer, Pre-Baked Hanamura Temple Courtyard Convolution Reverb,
 * and Adaptive Wafū In-Sen Pentatonic Soundscape (`和风阴旋五声动态战曲 + 寺院混响空间声学`).
 * Zero external audio files (.mp3/.wav/.ogg).
 */

export type SoundscapeMode = 'silent' | 'title' | 'calm' | 'combat' | 'boss';

export interface GenjiAudioDiagnostics {
  initialized: boolean;
  bgmEnabled: boolean;
  soundscapeMode: SoundscapeMode;
  soundscapeIntensity: number;
  cuesPlayed: number;
  bgmNotesPlayed: number;
  hasReverbBus: boolean;
}

export interface GenjiAudioController {
  resume: () => void;
  setVolume: (vol: number) => void;
  setBgmEnabled: (enabled: boolean) => void;
  getBgmEnabled: () => boolean;
  setSoundscapeState: (mode: SoundscapeMode, intensity?: number) => void;
  stepSoundscape: (dt: number) => void;
  getDiagnostics: () => GenjiAudioDiagnostics;
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
  // Phase 4 Dedicated Tactical Props, Synergy & Counterplay Cues
  caskDetonate: () => void;
  updraftLaunch: () => void;
  gongRing: () => void;
  synergyAwaken: (tier?: 1 | 2) => void;
  thunderWarning: () => void;
  coreInterrupt: () => void;
  guardBreak: () => void;
  rankUp: () => void;
}

// Japanese In-Sen (`陰旋法` / D-Eb-G-A-C) frequencies in Hz across 3 octaves
const IN_SEN_SCALE_HZ = [
  146.83, // D3
  155.56, // Eb3
  196.0,  // G3
  220.0,  // A3
  261.63, // C4
  293.66, // D4
  311.13, // Eb4
  392.0,  // G4
  440.0,  // A4
  523.25, // C5
  587.33, // D5
] as const;

const COMBAT_OSTINATO = [0, 2, 3, 2, 4, 3, 1, 0] as const;
const BOSS_OSTINATO = [0, 1, 3, 4, 5, 6, 3, 1] as const;
const CALM_MOTIF = [5, 7, 8, 7, 5, 3, 2, 5] as const;

export function createGenjiAudio(noAudio = false): GenjiAudioController {
  let volume = 0.85;
  let bgmEnabled = true;
  let soundscapeMode: SoundscapeMode = 'silent';
  let soundscapeIntensity = 0;
  let cuesPlayed = 0;
  let bgmNotesPlayed = 0;
  let bgmStepTimer = 0.35;
  let bgmStepIndex = 0;

  const hasBrowserWindow = !noAudio && typeof window !== 'undefined';
  const AudioCtx = hasBrowserWindow
    ? window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let reverbSend: GainNode | null = null;
  let bgmBus: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let hasReverbBus = false;

  const buildTempleImpulseBuffer = (c: AudioContext): AudioBuffer => {
    const duration = 1.35;
    const len = Math.max(1, Math.floor(c.sampleRate * duration));
    const ir = c.createBuffer(2, len, c.sampleRate);
    // Deterministic seeded PRNG so impulse synthesis is 100% reproducible & glitch-free
    let seed = 0x51a7f00d;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const earlyTapSamples = [
      Math.floor(c.sampleRate * 0.017),
      Math.floor(c.sampleRate * 0.031),
      Math.floor(c.sampleRate * 0.053),
      Math.floor(c.sampleRate * 0.079),
    ];

    for (let chIdx = 0; chIdx < 2; chIdx++) {
      const data = ir.getChannelData(chIdx);
      for (let i = 0; i < len; i++) {
        const t = i / c.sampleRate;
        const env = Math.exp(-t * 3.85) * (1 - Math.exp(-t * 95));
        data[i] = (nextRand() * 2 - 1) * env * 0.42;
      }
      // Stone wall & hinoki eave early reflections
      for (let k = 0; k < earlyTapSamples.length; k++) {
        const idx = earlyTapSamples[k] + chIdx * 19;
        if (idx < len) {
          data[idx] += (k % 2 === 0 ? 0.48 : -0.36) * Math.pow(0.74, k);
        }
      }
    }
    return ir;
  };

  const ensureCtx = (): AudioContext | null => {
    if (!AudioCtx) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtx({ latencyHint: 'interactive' });
        master = ctx.createGain();
        master.gain.value = volume * 0.82;

        // Soft master dynamics limiter preventing clipping when casks, ultimates & taiko overlap
        if (typeof ctx.createDynamicsCompressor === 'function') {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -10;
          comp.knee.value = 14;
          comp.ratio.value = 4.5;
          comp.attack.value = 0.004;
          comp.release.value = 0.14;
          master.connect(comp);
          comp.connect(ctx.destination);
        } else {
          master.connect(ctx.destination);
        }

        // Hanamura Temple Courtyard Convolution Reverb Send Bus
        if (typeof ctx.createConvolver === 'function') {
          const convolver = ctx.createConvolver();
          convolver.buffer = buildTempleImpulseBuffer(ctx);
          const dampFilter = ctx.createBiquadFilter();
          dampFilter.type = 'lowpass';
          dampFilter.frequency.value = 2850;
          reverbSend = ctx.createGain();
          reverbSend.gain.value = 0.26;
          reverbSend.connect(dampFilter);
          dampFilter.connect(convolver);
          convolver.connect(master);
          hasReverbBus = true;
        }

        // Dedicated BGM submix bus so combat SFX stay front-and-center
        bgmBus = ctx.createGain();
        bgmBus.gain.value = bgmEnabled ? 0.24 : 0.0001;
        bgmBus.connect(master);
        if (reverbSend) {
          const bgmVerb = ctx.createGain();
          bgmVerb.gain.value = 0.42;
          bgmBus.connect(bgmVerb);
          bgmVerb.connect(reverbSend);
        }

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
  };

  const playNoise = (
    c: AudioContext,
    dur: number,
    filterType: BiquadFilterType,
    fStart: number,
    fEnd: number,
    q: number,
    gainPeak: number,
    delay = 0,
    wetSend = 0.12
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
    if (reverbSend && wetSend > 0) {
      const wg = c.createGain();
      wg.gain.value = wetSend;
      g.connect(wg);
      wg.connect(reverbSend);
    }
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
    delay = 0,
    wetSend = 0.14,
    destNode?: AudioNode | null
  ) => {
    const target = destNode ?? master;
    if (!target) return;
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
    g.connect(target);
    if (!destNode && reverbSend && wetSend > 0) {
      const wg = c.createGain();
      wg.gain.value = wetSend;
      g.connect(wg);
      wg.connect(reverbSend);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  const triggerBgmStep = (step: number) => {
    bgmNotesPlayed++;
    if (!ctx || !bgmBus || ctx.state !== 'running') return;

    const inten = Math.max(0.15, Math.min(1, soundscapeIntensity));
    if (soundscapeMode === 'title' || soundscapeMode === 'calm') {
      // Airy Shakuhachi breath + distant Furin wind chime
      const noteHz = IN_SEN_SCALE_HZ[CALM_MOTIF[step % CALM_MOTIF.length]];
      playTone(ctx, 'sine', noteHz * 0.992, noteHz, 1.35, 0.14, 0, 0, bgmBus);
      playTone(ctx, 'triangle', noteHz * 2, noteHz * 2.002, 0.85, 0.045, 0.08, 0, bgmBus);
      if (step % 4 === 0) {
        playTone(ctx, 'sine', IN_SEN_SCALE_HZ[9], IN_SEN_SCALE_HZ[9], 0.65, 0.04, 0.22, 0, bgmBus);
      }
      return;
    }

    if (soundscapeMode === 'combat') {
      const idx = COMBAT_OSTINATO[step % COMBAT_OSTINATO.length];
      const hz = IN_SEN_SCALE_HZ[idx];
      // Crisp Koto / Shamisen pentatonic pluck
      playTone(ctx, 'triangle', hz * 1.008, hz, 0.28, 0.16 * inten, 0, 0, bgmBus);
      playTone(ctx, 'sine', hz * 2, hz * 1.998, 0.18, 0.08 * inten, 0.005, 0, bgmBus);
      // Sub-Taiko downbeat on steps 0 & 4, offbeat rim on step 6
      if (step % 4 === 0) {
        playTone(ctx, 'sine', 108, 42, 0.26, 0.24 * inten, 0, 0, bgmBus);
      } else if (step % 4 === 2 && inten > 0.55) {
        playTone(ctx, 'triangle', 320, 145, 0.09, 0.10 * inten, 0, 0, bgmBus);
      }
      return;
    }

    if (soundscapeMode === 'boss') {
      const idx = BOSS_OSTINATO[step % BOSS_OSTINATO.length];
      const hz = IN_SEN_SCALE_HZ[idx];
      // Urgent Raijin war-koto + thunderous O-Daiko cadence
      playTone(ctx, 'sawtooth', hz * 1.01, hz, 0.22, 0.13 * inten, 0, 0, bgmBus);
      playTone(ctx, 'triangle', hz * 2, hz * 2, 0.20, 0.11 * inten, 0.01, 0, bgmBus);
      if (step % 2 === 0) {
        playTone(ctx, 'sine', step % 4 === 0 ? 124 : 96, 34, 0.30, 0.30 * inten, 0, 0, bgmBus);
      }
      if (step % 8 === 7) {
        playTone(ctx, 'sine', IN_SEN_SCALE_HZ[6] * 2, IN_SEN_SCALE_HZ[5] * 2, 0.24, 0.12, 0, 0, bgmBus);
      }
    }
  };

  return {
    resume() {
      ensureCtx();
    },
    setVolume(vol: number) {
      volume = Math.max(0, Math.min(1, vol));
      if (master && ctx) {
        master.gain.setTargetAtTime(volume * 0.82, ctx.currentTime, 0.03);
      }
    },
    setBgmEnabled(enabled: boolean) {
      bgmEnabled = Boolean(enabled);
      if (bgmBus && ctx) {
        bgmBus.gain.setTargetAtTime(bgmEnabled ? 0.24 : 0.0001, ctx.currentTime, 0.06);
      }
    },
    getBgmEnabled() {
      return bgmEnabled;
    },
    setSoundscapeState(mode: SoundscapeMode, intensity = 0.5) {
      soundscapeMode = mode;
      soundscapeIntensity = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0.5));
      if (mode !== 'silent') {
        const targetInterval =
          mode === 'boss'
            ? 0.24
            : mode === 'combat'
              ? Math.max(0.28, 0.44 - soundscapeIntensity * 0.14)
              : 1.85;
        bgmStepTimer = Math.min(bgmStepTimer, targetInterval);
      }
    },
    stepSoundscape(dt: number) {
      if (!bgmEnabled || soundscapeMode === 'silent' || dt <= 0) return;
      bgmStepTimer -= Math.min(0.1, dt);
      if (bgmStepTimer > 0) return;

      const interval =
        soundscapeMode === 'boss'
          ? 0.24
          : soundscapeMode === 'combat'
            ? Math.max(0.28, 0.44 - soundscapeIntensity * 0.14)
            : 1.85;
      bgmStepTimer = interval;
      triggerBgmStep(bgmStepIndex++);
    },
    getDiagnostics(): GenjiAudioDiagnostics {
      return {
        initialized: ctx !== null,
        bgmEnabled,
        soundscapeMode,
        soundscapeIntensity,
        cuesPlayed,
        bgmNotesPlayed,
        hasReverbBus,
      };
    },
    shurikenThrow(fan = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const jitter = 0.94 + Math.random() * 0.12;
      playTone(c, 'triangle', 2750 * jitter, 4400 * jitter, fan ? 0.11 : 0.085, fan ? 0.2 : 0.15, 0, 0.08);
      playTone(c, 'sine', 5400 * jitter, 3100 * jitter, 0.07, 0.10, 0, 0.06);
      playNoise(c, fan ? 0.12 : 0.08, 'bandpass', 2400 * jitter, 6200 * jitter, 2.2, fan ? 0.26 : 0.18, 0, 0.06);
    },
    shurikenReload() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.12, 'bandpass', 900, 2400, 3.0, 0.14, 0, 0.05);
      playTone(c, 'triangle', 620, 1180, 0.14, 0.10, 0.04, 0.06);
      playTone(c, 'triangle', 1320, 1980, 0.14, 0.13, 0.36, 0.08);
      playTone(c, 'sine', 980, 2240, 0.22, 0.14, 0.56, 0.12);
    },
    doubleJump() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.17, 'bandpass', 620, 3100, 1.3, 0.24, 0, 0.10);
      playTone(c, 'sine', 250, 620, 0.14, 0.15, 0, 0.10);
    },
    wallClimbStep() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.16;
      playNoise(c, 0.075, 'bandpass', 420 * j, 1300 * j, 1.8, 0.15, 0, 0.05);
      playTone(c, 'triangle', 170 * j, 95 * j, 0.06, 0.11, 0, 0.04);
    },
    meleeSlash() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.16, 'bandpass', 1100, 4600, 1.5, 0.28, 0, 0.12);
      playTone(c, 'sawtooth', 1480, 580, 0.14, 0.13, 0, 0.12);
    },
    swiftStrike() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 165, 40, 0.24, 0.38, 0, 0.18);
      playNoise(c, 0.25, 'bandpass', 1400, 6800, 1.4, 0.36, 0, 0.22);
      playTone(c, 'sawtooth', 1850, 3900, 0.19, 0.17, 0, 0.20);
      playTone(c, 'sine', 3100, 1480, 0.24, 0.14, 0.04, 0.22);
    },
    swiftReset() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 1318.5, 1318.5, 0.12, 0.16, 0, 0.18);
      playTone(c, 'triangle', 1975.5, 2637, 0.19, 0.18, 0.045, 0.22);
    },
    deflectStart() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sawtooth', 1680, 4600, 0.24, 0.18, 0, 0.22);
      playTone(c, 'triangle', 2600, 4800, 0.28, 0.15, 0.06, 0.24);
      playNoise(c, 0.28, 'highpass', 2600, 6200, 2.2, 0.20, 0, 0.18);
    },
    deflectParry() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.18;
      playTone(c, 'triangle', 1840 * j, 1680 * j, 0.24, 0.34, 0, 0.28);
      playTone(c, 'sine', 3420 * j, 3120 * j, 0.28, 0.26, 0, 0.30);
      playTone(c, 'sine', 5280 * j, 4640 * j, 0.22, 0.18, 0, 0.25);
      playTone(c, 'sine', 145, 52, 0.10, 0.24, 0, 0.10);
      playNoise(c, 0.085, 'highpass', 3200, 7800, 2.8, 0.28, 0, 0.18);
    },
    dragonbladeCast() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 132, 34, 0.58, 0.48, 0, 0.36);
      playTone(c, 'sine', 112, 32, 0.48, 0.38, 0.20, 0.36);
      playTone(c, 'sawtooth', 980, 4120, 0.58, 0.24, 0.04, 0.42);
      playTone(c, 'triangle', 1960, 5100, 0.75, 0.20, 0.07, 0.45);
      playNoise(c, 1.35, 'bandpass', 280, 1620, 2.1, 0.40, 0.10, 0.40);
      playTone(c, 'sawtooth', 165, 310, 0.72, 0.24, 0.12, 0.35);
      playTone(c, 'sawtooth', 294, 132, 0.92, 0.26, 0.36, 0.38);
    },
    dragonSlash(heavyWave = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.94 + Math.random() * 0.12;
      playTone(c, 'sine', 155 * j, 44 * j, 0.24, 0.34, 0, 0.18);
      playNoise(c, 0.28, 'bandpass', 850 * j, 5200 * j, 1.3, 0.36, 0, 0.20);
      playTone(c, 'sawtooth', 920 * j, 2450 * j, 0.24, 0.22, 0, 0.22);
      playTone(c, 'triangle', (heavyWave ? 1480 : 1180) * j, 520 * j, 0.34, 0.20, 0.03, 0.25);
    },
    bladeCleaveImpact(isKill = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.93 + Math.random() * 0.14;
      playTone(c, 'sine', isKill ? 195 : 155, 38, isKill ? 0.22 : 0.15, isKill ? 0.42 : 0.32, 0, 0.16);
      playTone(c, 'sawtooth', 920 * j, 260 * j, 0.14, 0.22, 0, 0.14);
      playNoise(c, 0.13, 'bandpass', 1600 * j, 4800 * j, 1.7, 0.28, 0, 0.14);
    },
    structureBreak(isCollapse = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.9 + Math.random() * 0.2;
      playNoise(c, isCollapse ? 0.44 : 0.19, 'bandpass', (isCollapse ? 720 : 1200) * j, 210, 1.2, isCollapse ? 0.38 : 0.22, 0, 0.28);
      playTone(c, 'triangle', (isCollapse ? 130 : 185) * j, 36, isCollapse ? 0.34 : 0.14, isCollapse ? 0.36 : 0.20, 0, 0.24);
      if (isCollapse) {
        playNoise(c, 0.28, 'highpass', 2400, 5600, 1.8, 0.18, 0.06, 0.26);
      }
    },
    upgradePick() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'triangle', 587.3, 587.3, 0.22, 0.15, 0, 0.28);
      playTone(c, 'triangle', 698.5, 698.5, 0.24, 0.15, 0.06, 0.28);
      playTone(c, 'triangle', 880.0, 880.0, 0.28, 0.16, 0.12, 0.30);
      playTone(c, 'sine', 1174.7, 1174.7, 0.42, 0.17, 0.18, 0.35);
    },
    waveBanner(isBoss = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      if (isBoss) {
        playTone(c, 'sawtooth', 92.5, 55.0, 0.85, 0.32, 0, 0.42);
        playTone(c, 'sine', 110, 38, 0.7, 0.40, 0, 0.38);
        playNoise(c, 0.65, 'lowpass', 600, 180, 2.0, 0.26, 0, 0.35);
      } else {
        playTone(c, 'sine', 115, 44, 0.42, 0.28, 0, 0.30);
        playTone(c, 'triangle', 440, 659.25, 0.32, 0.14, 0.06, 0.32);
      }
    },
    katanaSheathe() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.09, 'bandpass', 1800, 4200, 2.0, 0.16, 0, 0.14);
      playTone(c, 'triangle', 2900, 1450, 0.16, 0.12, 0.08, 0.16);
      playTone(c, 'sine', 1240, 420, 0.065, 0.24, 0.23, 0.18);
      playNoise(c, 0.045, 'highpass', 2800, 5600, 2.6, 0.20, 0.23, 0.16);
    },
    colossusRoar() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 96, 28, 0.85, 0.48, 0, 0.45);
      playTone(c, 'sawtooth', 118, 62, 1.05, 0.28, 0.04, 0.48);
      playTone(c, 'triangle', 236, 114, 0.92, 0.22, 0.08, 0.45);
      playNoise(c, 1.0, 'lowpass', 780, 190, 2.4, 0.36, 0.05, 0.42);
    },
    colossusSlam() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 142, 26, 0.62, 0.50, 0, 0.38);
      playTone(c, 'triangle', 210, 44, 0.45, 0.30, 0.02, 0.35);
      playNoise(c, 0.55, 'bandpass', 920, 160, 1.4, 0.40, 0, 0.38);
      playTone(c, 'sawtooth', 680, 240, 0.28, 0.16, 0.03, 0.28);
    },
    orbShatter() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 1568, 3136, 0.32, 0.26, 0, 0.35);
      playTone(c, 'triangle', 2349, 1174, 0.38, 0.22, 0.03, 0.35);
      playTone(c, 'sine', 180, 42, 0.28, 0.36, 0, 0.24);
      playNoise(c, 0.22, 'highpass', 3400, 8200, 2.2, 0.30, 0, 0.28);
    },
    pulseRifleShot(visorLock = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.96 + Math.random() * 0.08;
      playTone(c, 'sawtooth', (visorLock ? 1140 : 940) * j, 175 * j, 0.072, 0.25, 0, 0.08);
      playTone(c, 'sine', 210 * j, 46, 0.075, 0.34, 0, 0.06);
      playTone(c, 'triangle', 2680 * j, 1180 * j, 0.032, 0.14, 0, 0.06);
      playNoise(c, 0.058, 'bandpass', 2200 * j, 5400 * j, 1.5, 0.25, 0, 0.08);
      if (visorLock) {
        playTone(c, 'triangle', 2850 * j, 2020 * j, 0.042, 0.13, 0, 0.10);
      }
    },
    helixLaunch() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sawtooth', 320, 960, 0.19, 0.24, 0, 0.18);
      playTone(c, 'triangle', 480, 1280, 0.18, 0.20, 0.04, 0.18);
      playNoise(c, 0.24, 'bandpass', 950, 4200, 1.8, 0.32, 0, 0.16);
    },
    helixExplode() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.16;
      playTone(c, 'sine', 148 * j, 30, 0.42, 0.48, 0, 0.32);
      playTone(c, 'sawtooth', 260 * j, 58, 0.28, 0.28, 0.02, 0.28);
      playNoise(c, 0.38, 'lowpass', 1400 * j, 220, 1.5, 0.40, 0, 0.32);
    },
    bioticDeploy() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 220, 88, 0.16, 0.26, 0, 0.20);
      playTone(c, 'triangle', 523.25, 1046.5, 0.28, 0.18, 0.05, 0.28);
      playTone(c, 'sine', 783.99, 1567.98, 0.36, 0.16, 0.11, 0.30);
    },
    visorCast() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sawtooth', 280, 1480, 0.38, 0.22, 0, 0.32);
      playTone(c, 'sine', 880, 1760, 0.24, 0.22, 0.18, 0.34);
      playTone(c, 'triangle', 1760, 2637, 0.30, 0.24, 0.32, 0.36);
      playNoise(c, 0.26, 'bandpass', 1600, 5600, 2.4, 0.20, 0.04, 0.24);
    },
    shieldRicochet() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.90 + Math.random() * 0.20;
      playTone(c, 'triangle', 2200 * j, 920 * j, 0.12, 0.20, 0, 0.18);
      playNoise(c, 0.06, 'highpass', 3400, 6800, 2.5, 0.18, 0, 0.14);
    },
    bulletHitConfirm(isCrit = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.97 + Math.random() * 0.06;
      if (isCrit) {
        playTone(c, 'sine', 2180 * j, 2960 * j, 0.065, 0.22, 0, 0.08);
        playTone(c, 'triangle', 3320 * j, 2640 * j, 0.055, 0.16, 0.01, 0.08);
      } else {
        playTone(c, 'triangle', 1420 * j, 860 * j, 0.036, 0.15, 0, 0.04);
        playNoise(c, 0.024, 'highpass', 2600, 5200, 1.8, 0.11, 0, 0.04);
      }
    },
    bowDrawStart() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.14, 'bandpass', 540, 1380, 3.2, 0.12, 0, 0.06);
      playTone(c, 'triangle', 190, 360, 0.22, 0.10, 0.01, 0.06);
    },
    bowRelease(chargeRatio = 1, isStorm = false) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const p = Math.max(0.2, Math.min(1, chargeRatio));
      const j = 0.95 + Math.random() * 0.10;
      if (isStorm) {
        playTone(c, 'sawtooth', 1640 * j, 520 * j, 0.10, 0.24, 0, 0.14);
        playTone(c, 'sine', 2680 * j, 1240 * j, 0.09, 0.20, 0.01, 0.14);
        playNoise(c, 0.085, 'bandpass', 2200, 6400, 1.8, 0.24, 0, 0.12);
      } else {
        playTone(c, 'triangle', (320 + p * 260) * j, 135 * j, 0.18 + p * 0.08, 0.18 + p * 0.14, 0, 0.18);
        playTone(c, 'sine', (1180 + p * 840) * j, 620 * j, 0.11, 0.12 + p * 0.10, 0, 0.16);
        playNoise(c, 0.10 + p * 0.06, 'bandpass', 1400, 4800 + p * 1800, 1.7, 0.16 + p * 0.14, 0, 0.14);
      }
    },
    stormArrowsCast() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 440, 1320, 0.24, 0.22, 0, 0.24);
      playTone(c, 'triangle', 880, 2200, 0.28, 0.20, 0.05, 0.26);
      playNoise(c, 0.22, 'highpass', 2400, 6800, 2.2, 0.20, 0, 0.20);
    },
    stormRicochet() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      const j = 0.92 + Math.random() * 0.16;
      playTone(c, 'sine', 2480 * j, 3720 * j, 0.10, 0.18, 0, 0.20);
      playNoise(c, 0.05, 'highpass', 3600, 7600, 2.6, 0.15, 0, 0.16);
    },
    sonicArrowPulse() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 1567.98, 1567.98, 0.34, 0.22, 0, 0.36);
      playTone(c, 'triangle', 2349.32, 1975.53, 0.42, 0.16, 0.04, 0.38);
      playTone(c, 'sine', 392.0, 196.0, 0.38, 0.18, 0.02, 0.30);
    },
    hanzoLunge() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playNoise(c, 0.18, 'bandpass', 780, 3800, 1.5, 0.26, 0, 0.14);
      playTone(c, 'sine', 310, 780, 0.16, 0.18, 0, 0.14);
    },
    dragonstrikeCast() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 124, 30, 0.72, 0.50, 0, 0.45);
      playTone(c, 'sine', 98, 28, 0.65, 0.42, 0.22, 0.45);
      playTone(c, 'sawtooth', 196, 392, 0.85, 0.26, 0.08, 0.48);
      playTone(c, 'triangle', 587.33, 293.66, 1.15, 0.24, 0.28, 0.50);
      playNoise(c, 1.65, 'bandpass', 260, 1840, 1.9, 0.42, 0.10, 0.44);
    },
    // =========================================================================
    // PHASE 4 DEDICATED TACTICAL PROPS, SYNERGY & COUNTERPLAY CUES
    // =========================================================================
    caskDetonate() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      // Lacquer barrel shatter + booming Raijin black-powder sub + roaring fireblast
      playNoise(c, 0.09, 'highpass', 2200, 6400, 2.0, 0.28, 0, 0.20);
      playTone(c, 'sine', 168, 28, 0.52, 0.52, 0.01, 0.38);
      playTone(c, 'sawtooth', 290, 52, 0.34, 0.30, 0.02, 0.32);
      playNoise(c, 0.48, 'bandpass', 1250, 195, 1.3, 0.42, 0.015, 0.36);
    },
    updraftLaunch() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      // Fujin jade wind-vortex whoosh + airy bamboo flute fifth
      playNoise(c, 0.36, 'bandpass', 480, 3900, 1.8, 0.30, 0, 0.32);
      playTone(c, 'sine', 293.66, 587.33, 0.32, 0.20, 0.02, 0.36);
      playTone(c, 'triangle', 440.0, 880.0, 0.28, 0.14, 0.07, 0.38);
    },
    gongRing() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      // Authentic multi-partial Japanese Bonshō bronze temple bell with beating harmonics & lush courtyard tail!
      playTone(c, 'sine', 196.0, 195.2, 1.65, 0.36, 0, 0.58);
      playTone(c, 'sine', 198.4, 197.8, 1.55, 0.22, 0.005, 0.58);
      playTone(c, 'triangle', 392.0, 390.5, 1.25, 0.24, 0, 0.52);
      playTone(c, 'sine', 587.33, 584.0, 0.95, 0.18, 0.01, 0.48);
      playTone(c, 'sine', 932.33, 926.0, 0.62, 0.14, 0.01, 0.42);
      playNoise(c, 0.07, 'bandpass', 900, 2800, 2.4, 0.22, 0, 0.24);
    },
    synergyAwaken(tier: 1 | 2 = 1) {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      // Ascending Koto In-Sen chord (D4 -> G4 -> A4 -> D5, + G5 shimmer on Tier II)
      const notes = tier === 2 ? [293.66, 392.0, 440.0, 587.33, 783.99] : [293.66, 392.0, 440.0, 587.33];
      for (let i = 0; i < notes.length; i++) {
        playTone(c, 'triangle', notes[i] * 1.006, notes[i], 0.36 + i * 0.06, 0.18, i * 0.055, 0.42);
        playTone(c, 'sine', notes[i] * 2, notes[i] * 2, 0.28, 0.09, i * 0.055 + 0.01, 0.44);
      }
    },
    thunderWarning() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      // Ominous Raijin electric arc + warning taiko double-hit
      playTone(c, 'sine', 118, 38, 0.32, 0.38, 0, 0.36);
      playTone(c, 'sine', 128, 42, 0.32, 0.38, 0.16, 0.36);
      playTone(c, 'sawtooth', 420, 1680, 0.55, 0.20, 0.05, 0.38);
      playNoise(c, 0.48, 'highpass', 2400, 7600, 3.2, 0.24, 0.06, 0.32);
    },
    coreInterrupt() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      // Shattered Raijin Heart Core discharge + sub-drop backlash + triumphant bell harmonic!
      playTone(c, 'sine', 220, 30, 0.55, 0.50, 0, 0.40);
      playTone(c, 'sawtooth', 2400, 180, 0.38, 0.28, 0, 0.38);
      playTone(c, 'sine', 1174.66, 2349.32, 0.42, 0.26, 0.04, 0.48);
      playTone(c, 'triangle', 1760.0, 3520.0, 0.38, 0.20, 0.08, 0.48);
      playNoise(c, 0.30, 'highpass', 3200, 8800, 2.4, 0.34, 0, 0.35);
    },
    guardBreak() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'triangle', 640, 140, 0.18, 0.28, 0, 0.22);
      playNoise(c, 0.14, 'bandpass', 1400, 3800, 2.0, 0.24, 0, 0.20);
    },
    rankUp() {
      cuesPlayed++;
      const c = ensureCtx();
      if (!c) return;
      playTone(c, 'sine', 116.5, 38, 0.48, 0.38, 0, 0.40);
      const fanfare = [293.66, 392.0, 440.0, 587.33, 880.0];
      for (let i = 0; i < fanfare.length; i++) {
        playTone(c, 'triangle', fanfare[i], fanfare[i], 0.42, 0.18, 0.07 * i, 0.45);
      }
    },
  };
}
