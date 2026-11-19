/**
 * Tri-Hero Pro Mobile & Multi-Touch Controller (`花村 · 和平精英 / 瓦罗兰特手游级竞技触控系统`)
 *
 * Pro Tactical Mobile FPS Features:
 * 1. Left Movement Zone + Auto-Sprint Lock (`上滑锁定疾跑`):
 *    - Dynamic floating-follow thumbstick (`computeFloatingStickOrigin` + `0.08` deadzone)
 *    - Peacekeeper Elite / Valorant Mobile upward sprint-latch pill (`▲ 上滑锁定疾跑` -> `⚡ 疾跑锁定中`),
 *      enabling hands-free continuous forward sprinting until cancelled by stick touch or backward pull.
 * 2. Ergonomic Upper-Left Claw / Dual-Fire Trigger (`左手食指开火键` `.gt-lfire`):
 *    - Placed in the classic PUBG / Valorant Mobile upper-left trigger zone (`claw3` / `thumb2` presets),
 *      100% clear of the left movement thumbstick.
 * 3. Pro Camera Aiming Curve + Firing Recoil-Control Stability + Coalesced 120Hz Sampling + Gyroscope:
 *    - `PointerEvent.getCoalescedEvents?.()` high-rate sub-frame sampling
 *    - Velocity-aware S-curve (`computeProTouchLookDelta`: `'speed' | 'linear'`)
 *    - Separate Firing Sensitivity Ratio (`firingSensitivity`, default `0.80×`) + sub-pixel tap-jitter gate
 *      so pressing/holding Fire never jerks headshots off-target and pulling down to control recoil (`压枪`) is rock-steady!
 *    - Landscape-aware Gyroscope Fine-Aim (`DeviceOrientationEvent` + iOS 13+ `requestPermission()` user-gesture support):
 *      `'off' | 'ads_fire' | 'always'`.
 * 4. Valorant Mobile Tactical HUD & Action Cluster:
 *    - SVG 360° circular cooldown/charge progress rings around `Q`, `Shift`, `E`, and `扇/弹/收`
 *    - Dedicated Crouch / Tactical Peek toggle (`蹲`, `data-btn="crouch"`), auto-cancelling on Jump or Sprint
 *    - Compact bottom-center Tactical Status Capsule (`gt-hud-bar`) with live HP bar + numerical HP + Ammo/Bow readout
 *    - Customizable HUD Button Opacity (`buttonOpacity`, `45%..100%`) for zero screen clutter!
 */

import {
  clamp01,
  computeFloatingStickOrigin,
  computeGyroLookDelta,
  computeProTouchLookDelta,
  computeSprintLatchState,
  computeVirtualStick,
  isPortraitViewportBlocked,
  shouldEnableTouchUi,
  type GenjiCooldownState,
  type GunnerCooldownState,
  type HanzoCooldownState,
  type HeroClassId,
  type TouchAccelMode,
  type TouchGyroMode,
  type TouchLayoutPreset,
  type TouchUiPreference,
} from './roguelike.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GenjiTouchActions {
  onSwiftStrike: () => void;
  onDeflect: () => void;
  onDragonblade: () => void;
  onPause: () => void;
  onAudioUnlock: () => void;
}

export interface GenjiTouchController {
  root: HTMLElement;
  readonly active: boolean;
  readonly portraitBlocked: boolean;
  readonly stickMagnitude: number;
  readonly sprintLocked: boolean;
  preference: TouchUiPreference;
  touchSensitivity: number;
  firingSensitivity: number;
  accelMode: TouchAccelMode;
  gyroMode: TouchGyroMode;
  gyroSensitivity: number;
  layoutPreset: TouchLayoutPreset;
  buttonOpacity: number;
  aimAssistEnabled: boolean;
  setPreference: (pref: TouchUiPreference) => void;
  setTouchSensitivity: (sens: number) => void;
  setFiringSensitivity: (ratio: number) => void;
  setAccelMode: (mode: TouchAccelMode) => void;
  setGyroMode: (mode: TouchGyroMode) => Promise<boolean>;
  setGyroSensitivity: (sens: number) => void;
  setLayoutPreset: (preset: TouchLayoutPreset) => void;
  setButtonOpacity: (opacity: number) => void;
  setAimAssistEnabled: (enabled: boolean) => void;
  setGameplayVisible: (inGameplay: boolean) => void;
  requestLandscapeLock: () => void;
  setInteractAvailable: (available: boolean, progress?: number) => void;
  isSprinting: () => boolean;
  isCrouching: () => boolean;
  setCrouching: (crouched: boolean) => void;
  consumeJumpPressed: () => boolean;
  isJumpHeld: () => boolean;
  consumeFanPressed: () => boolean;
  isFireHeld: () => boolean;
  consumeFirePressed: () => boolean;
  consumeMeleePressed: () => boolean;
  consumeReloadPressed: () => boolean;
  isInteractHeld: () => boolean;
  applyToInput: () => void;
  setHeroClass: (hero: HeroClassId) => void;
  syncVitals: (hp: number, maxHp: number, ammoDisplay: string, isLowHp?: boolean) => void;
  syncHudState: (
    cd: GenjiCooldownState,
    isWallClimbing: boolean,
    swiftResetFlash: boolean,
    ammo: number,
    magSize: number,
    swiftMaxCd?: number,
    deflectMaxCd?: number
  ) => void;
  syncGunnerHudState: (
    cd: GunnerCooldownState,
    ammo: number,
    magSize: number,
    helixMaxCd?: number,
    bioticMaxCd?: number
  ) => void;
  syncHanzoHudState: (
    cd: HanzoCooldownState,
    isWallClimbing: boolean,
    sonicMaxCd?: number,
    stormMaxCd?: number
  ) => void;
}

const PREF_KEY = 'shimada_genji_touch_pref_v1';
const TOUCH_SENS_KEY = 'shimada_touch_sens_v1';
const FIRE_SENS_KEY = 'shimada_touch_fire_sens_v1';
const ACCEL_MODE_KEY = 'shimada_touch_accel_v1';
const GYRO_MODE_KEY = 'shimada_touch_gyro_mode_v1';
const GYRO_SENS_KEY = 'shimada_touch_gyro_sens_v1';
const LAYOUT_PRESET_KEY = 'shimada_touch_layout_v1';
const BTN_OPACITY_KEY = 'shimada_touch_opacity_v1';
const AIM_ASSIST_KEY = 'shimada_touch_aim_assist_v1';

const RING_CIRC = 163.36; // 2 * Math.PI * 26

export function createGenjiTouchController(
  G: any,
  uiRoot: HTMLElement,
  actions: GenjiTouchActions
): GenjiTouchController {
  let preference: TouchUiPreference = 'auto';
  let touchSensitivity = 1.0;
  let firingSensitivity = 0.8;
  let accelMode: TouchAccelMode = 'speed';
  let gyroMode: TouchGyroMode = 'off';
  let gyroSensitivity = 1.0;
  let layoutPreset: TouchLayoutPreset = 'claw3';
  let buttonOpacity = 0.86;
  let aimAssistEnabled = true;

  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === 'auto' || saved === 'on' || saved === 'off') {
      preference = saved;
    }
    const savedSens = Number(localStorage.getItem(TOUCH_SENS_KEY));
    if (Number.isFinite(savedSens) && savedSens >= 0.3 && savedSens <= 2.5) {
      touchSensitivity = savedSens;
    }
    const savedFireSens = Number(localStorage.getItem(FIRE_SENS_KEY));
    if (Number.isFinite(savedFireSens) && savedFireSens >= 0.4 && savedFireSens <= 1.4) {
      firingSensitivity = savedFireSens;
    }
    const savedAccel = localStorage.getItem(ACCEL_MODE_KEY);
    if (savedAccel === 'speed' || savedAccel === 'linear') {
      accelMode = savedAccel;
    }
    const savedGyro = localStorage.getItem(GYRO_MODE_KEY);
    if (savedGyro === 'off' || savedGyro === 'ads_fire' || savedGyro === 'always') {
      gyroMode = savedGyro;
    }
    const savedGyroSens = Number(localStorage.getItem(GYRO_SENS_KEY));
    if (Number.isFinite(savedGyroSens) && savedGyroSens >= 0.25 && savedGyroSens <= 2.5) {
      gyroSensitivity = savedGyroSens;
    }
    const savedLayout = localStorage.getItem(LAYOUT_PRESET_KEY);
    if (savedLayout === 'thumb2' || savedLayout === 'claw3') {
      layoutPreset = savedLayout;
    }
    const savedOpa = Number(localStorage.getItem(BTN_OPACITY_KEY));
    if (Number.isFinite(savedOpa) && savedOpa >= 0.4 && savedOpa <= 1.0) {
      buttonOpacity = savedOpa;
    }
    const savedAssist = localStorage.getItem(AIM_ASSIST_KEY);
    if (savedAssist === '0' || savedAssist === 'false') {
      aimAssistEnabled = false;
    }
  } catch {
    // ignore storage errors in restricted iframes
  }

  let sawTouchEvent = false;
  let inGameplay = false;
  let isActive = false;
  let isPortraitBlocked = false;

  // Virtual thumbstick + Peacekeeper Elite / Valorant Mobile Sprint-Lock state
  const STICK_MAX_RADIUS_PX = 44;
  const STICK_FOLLOW_SLACK_PX = 8;
  let stickPointerId: number | null = null;
  let stickOriginX = 0;
  let stickOriginY = 0;
  let stickTouchDownX = 0;
  let stickTouchDownY = 0;
  let stickMoveX = 0;
  let stickMoveY = 0;
  let stickMagnitude = 0;
  let stickSprint = false;
  let isSprintLatched = false;
  let latchZoneEnterMs = 0;
  let inSprintLatchZone = false;

  // Tactical crouch toggle (`蹲`, stands up automatically when sprinting or jumping)
  let crouchToggled = false;

  // Look swipe state (supports open screen AND drag-through aiming on ALL right-hand / left-fire buttons!)
  interface LookPointerTrack {
    x: number;
    y: number;
    vx: number;
    vy: number;
    lastTimeMs: number;
    sourceBtn: string | null;
  }
  const lookPointers = new Map<number, LookPointerTrack>();

  // Gyroscope orientation tracking (`DeviceOrientationEvent`)
  let gyroListenerAttached = false;
  let lastGyroBeta: number | null = null;
  let lastGyroGamma: number | null = null;

  // Button states
  const heldButtons = new Map<string, Set<number>>();
  let jumpJustPressed = false;
  let fanJustPressed = false;
  let fireJustPressed = false;
  let meleeJustPressed = false;
  let reloadJustPressed = false;

  const isHeld = (btnKey: string): boolean => {
    const set = heldButtons.get(btnKey);
    return !!set && set.size > 0;
  };

  const pulseHaptic = (ms = 8) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms);
      }
    } catch {
      // ignore unsupported vibration API
    }
  };

  const nowMs = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  // Build ergonomic Peacekeeper Elite / Valorant Mobile landscape overlay DOM
  const root = document.createElement('div');
  root.id = 'g-touch';
  root.className = 'g-touch';
  root.dataset.layout = layoutPreset;
  root.setAttribute('aria-label', '移动端竞技触控面板');
  root.innerHTML = `
    <div class="gt-stick-zone" data-zone="stick" aria-label="动态移动与疾跑锁定区">
      <div class="gt-stick">
        <div class="gt-sprint-latch" data-f="sprint-latch">
          <span class="gt-latch-ico">▲</span>
          <span class="gt-latch-txt" data-f="latch-txt">上滑疾跑</span>
        </div>
        <div class="gt-stick-ring"></div>
        <div class="gt-stick-nub"></div>
      </div>
    </div>

    <div class="gt-look-zone" data-zone="look" aria-label="滑动转向瞄准区"></div>

    <button type="button" class="gt-btn gt-lfire" data-btn="lfire" aria-label="左手开火键">
      <span class="gt-fire-reticle"></span>
      <span class="gt-main" data-f="lfire-lbl">镖</span>
      <span class="gt-sub" data-f="lfire-sub">左火</span>
    </button>

    <button type="button" class="gt-btn gt-pause" data-btn="pause" aria-label="暂停与设置">
      <span class="gt-ico">||</span>
      <span class="gt-txt">设置</span>
    </button>

    <button type="button" class="gt-btn gt-interact" data-btn="interact" hidden aria-label="互动或祈愿">
      <span class="gt-int-fill"></span>
      <span class="gt-txt">按住 · 祈愿净火</span>
    </button>

    <div class="gt-hud-bar" aria-label="移动端生命与弹药状态栏">
      <div class="gt-hb-hp">
        <span class="gt-hb-k">HP</span>
        <div class="gt-hb-track"><i class="gt-hb-fill" data-f="hp-fill"></i></div>
        <b class="gt-hb-val" data-f="hp-val">200</b>
      </div>
      <div class="gt-hb-sep"></div>
      <div class="gt-hb-ammo">
        <b class="gt-hb-ammo-val" data-f="ammo-val">24 / ∞</b>
      </div>
    </div>

    <div class="gt-cluster" aria-label="竞技技能与射击操作区">
      <button type="button" class="gt-btn gt-ult" data-btn="ult" aria-label="终极奥义技能">
        <svg class="gt-ring-svg" viewBox="0 0 60 60" aria-hidden="true">
          <circle class="gt-ring-bg" cx="30" cy="30" r="26"></circle>
          <circle class="gt-ring-fg" data-f="ring-ult" cx="30" cy="30" r="26" stroke-dasharray="163.36" stroke-dashoffset="163.36"></circle>
        </svg>
        <span class="gt-main" data-f="ult-lbl">斩</span>
        <span class="gt-sub" data-f="ult-pct">0%</span>
      </button>

      <button type="button" class="gt-btn gt-skill gt-swift" data-btn="swift" aria-label="身法或侦察技能">
        <svg class="gt-ring-svg" viewBox="0 0 60 60" aria-hidden="true">
          <circle class="gt-ring-bg" cx="30" cy="30" r="26"></circle>
          <circle class="gt-ring-fg" data-f="ring-swift" cx="30" cy="30" r="26" stroke-dasharray="163.36" stroke-dashoffset="0"></circle>
        </svg>
        <span class="gt-main" data-f="swift-lbl">影</span>
        <span class="gt-sub" data-f="swift-cd">就绪</span>
      </button>

      <button type="button" class="gt-btn gt-skill gt-deflect" data-btn="deflect" aria-label="核心战术技能">
        <svg class="gt-ring-svg" viewBox="0 0 60 60" aria-hidden="true">
          <circle class="gt-ring-bg" cx="30" cy="30" r="26"></circle>
          <circle class="gt-ring-fg" data-f="ring-deflect" cx="30" cy="30" r="26" stroke-dasharray="163.36" stroke-dashoffset="0"></circle>
        </svg>
        <span class="gt-main" data-f="deflect-lbl">闪</span>
        <span class="gt-sub" data-f="deflect-cd">就绪</span>
      </button>

      <button type="button" class="gt-btn gt-jump" data-btn="jump" aria-label="跳跃、二段跳与爬墙">
        <span class="gt-main" data-f="jump-lbl">灵</span>
        <span class="gt-sub" data-f="jump-st">跳/爬</span>
      </button>

      <button type="button" class="gt-btn gt-crouch" data-btn="crouch" aria-label="战术下蹲掩体射击">
        <span class="gt-main">蹲</span>
        <span class="gt-sub" data-f="crouch-st">站立</span>
      </button>

      <button type="button" class="gt-btn gt-fan" data-btn="fan" aria-label="副武器齐射或收弓">
        <svg class="gt-ring-svg" viewBox="0 0 60 60" aria-hidden="true">
          <circle class="gt-ring-bg" cx="30" cy="30" r="26"></circle>
          <circle class="gt-ring-fg" data-f="ring-fan" cx="30" cy="30" r="26" stroke-dasharray="163.36" stroke-dashoffset="0"></circle>
        </svg>
        <span class="gt-main" data-f="fan-lbl">扇</span>
        <span class="gt-sub" data-f="fan-sub">齐射</span>
      </button>

      <button type="button" class="gt-btn gt-fire" data-btn="fire" aria-label="主武器开火或跟枪压枪">
        <span class="gt-fire-reticle"></span>
        <span class="gt-main" data-f="fire-lbl">镖</span>
        <span class="gt-sub" data-f="fire-sub">24</span>
      </button>

      <button type="button" class="gt-btn gt-mini gt-melee" data-btn="melee" aria-label="近战快斩">
        <span class="gt-main">刃</span>
      </button>

      <button type="button" class="gt-btn gt-mini gt-reload" data-btn="reload" aria-label="装填弹药">
        <span class="gt-main">换</span>
      </button>
    </div>
  `;
  uiRoot.appendChild(root);

  const applyButtonOpacityCss = () => {
    if (root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty('--gt-alpha', buttonOpacity.toFixed(2));
    }
  };
  applyButtonOpacityCss();

  const stickZoneEl = root.querySelector('.gt-stick-zone') as HTMLElement;
  const stickBaseEl = root.querySelector('.gt-stick') as HTMLElement;
  const stickNubEl = root.querySelector('.gt-stick-nub') as HTMLElement;
  const sprintLatchEl = root.querySelector('[data-f="sprint-latch"]') as HTMLElement;
  const latchTxtEl = root.querySelector('[data-f="latch-txt"]') as HTMLElement;
  const lookZoneEl = root.querySelector('.gt-look-zone') as HTMLElement;
  const interactBtnEl = root.querySelector('.gt-interact') as HTMLButtonElement;
  const interactFillEl = root.querySelector('.gt-int-fill') as HTMLElement;

  const hudBarEl = root.querySelector('.gt-hud-bar') as HTMLElement;
  const hpFillEl = root.querySelector('[data-f="hp-fill"]') as HTMLElement;
  const hpValEl = root.querySelector('[data-f="hp-val"]') as HTMLElement;
  const ammoValEl = root.querySelector('[data-f="ammo-val"]') as HTMLElement;

  const lfireBtnEl = root.querySelector('.gt-lfire') as HTMLButtonElement;
  const lfireLblEl = root.querySelector('[data-f="lfire-lbl"]') as HTMLElement;
  const lfireSubEl = root.querySelector('[data-f="lfire-sub"]') as HTMLElement;

  const ultBtnEl = root.querySelector('.gt-ult') as HTMLButtonElement;
  const ultMainEl = root.querySelector('[data-f="ult-lbl"]') as HTMLElement;
  const ultPctEl = root.querySelector('[data-f="ult-pct"]') as HTMLElement;
  const ringUltEl = root.querySelector('[data-f="ring-ult"]') as SVGCircleElement;

  const swiftBtnEl = root.querySelector('.gt-swift') as HTMLButtonElement;
  const swiftMainEl = root.querySelector('[data-f="swift-lbl"]') as HTMLElement;
  const swiftCdEl = root.querySelector('[data-f="swift-cd"]') as HTMLElement;
  const ringSwiftEl = root.querySelector('[data-f="ring-swift"]') as SVGCircleElement;

  const deflectBtnEl = root.querySelector('.gt-deflect') as HTMLButtonElement;
  const deflectMainEl = root.querySelector('[data-f="deflect-lbl"]') as HTMLElement;
  const deflectCdEl = root.querySelector('[data-f="deflect-cd"]') as HTMLElement;
  const ringDeflectEl = root.querySelector('[data-f="ring-deflect"]') as SVGCircleElement;

  const jumpBtnEl = root.querySelector('.gt-jump') as HTMLButtonElement;
  const jumpMainEl = root.querySelector('[data-f="jump-lbl"]') as HTMLElement;
  const jumpStEl = root.querySelector('[data-f="jump-st"]') as HTMLElement;

  const crouchBtnEl = root.querySelector('.gt-crouch') as HTMLButtonElement;
  const crouchStEl = root.querySelector('[data-f="crouch-st"]') as HTMLElement;

  const fanBtnEl = root.querySelector('.gt-fan') as HTMLButtonElement;
  const fanMainEl = root.querySelector('[data-f="fan-lbl"]') as HTMLElement;
  const fanSubEl = root.querySelector('[data-f="fan-sub"]') as HTMLElement;
  const ringFanEl = root.querySelector('[data-f="ring-fan"]') as SVGCircleElement;

  const fireBtnEl = root.querySelector('.gt-fire') as HTMLButtonElement;
  const fireLblEl = root.querySelector('[data-f="fire-lbl"]') as HTMLElement;
  const fireSubEl = root.querySelector('[data-f="fire-sub"]') as HTMLElement;
  const reloadBtnEl = root.querySelector('.gt-reload') as HTMLButtonElement;

  let activeHero: HeroClassId = 'genji';

  const setRingProgress = (circleEl: SVGCircleElement | null, progress01: number) => {
    if (!circleEl) return;
    const clamped = clamp01(progress01);
    circleEl.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - clamped)).toFixed(1));
  };

  const syncCrouchVisual = () => {
    crouchBtnEl.classList.toggle('active', crouchToggled);
    crouchStEl.textContent = crouchToggled ? '下蹲中' : '站立';
  };

  const syncSprintLatchVisual = () => {
    stickBaseEl.classList.toggle('latched', isSprintLatched);
    sprintLatchEl.classList.toggle('near', inSprintLatchZone && !isSprintLatched);
    sprintLatchEl.classList.toggle('locked', isSprintLatched);
    latchTxtEl.textContent = isSprintLatched
      ? '疾跑锁定'
      : inSprintLatchZone
        ? '松手锁定'
        : '上滑疾跑';
  };

  function evaluateTouchActive(): boolean {
    const coarse =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
    const maxPts = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const urlParam = G.params && G.params.touch !== undefined ? String(G.params.touch) : undefined;
    return shouldEnableTouchUi({
      urlTouchParam: urlParam,
      userPref: preference,
      maxTouchPoints: maxPts,
      coarsePointer: coarse,
      viewportWidth: vw,
      viewportHeight: vh,
      sawTouchEvent,
    });
  }

  function requestLandscapeLock() {
    try {
      const ori = (typeof screen !== 'undefined' && (screen as any).orientation) || null;
      if (ori && typeof ori.lock === 'function') {
        const p = ori.lock('landscape');
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      // Orientation lock requires fullscreen in some mobile browsers; fail silently
    }
  }

  function refreshVisibility() {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    isPortraitBlocked = isPortraitViewportBlocked({ width: vw, height: vh });
    document.documentElement.classList.toggle('is-portrait-blocked', isPortraitBlocked);

    isActive = evaluateTouchActive();
    document.documentElement.classList.toggle('is-genji-touch', isActive);
    if (G.input) {
      G.input.touch = isActive;
      if ((isActive || isPortraitBlocked) && G.input.exitLock) {
        G.input.exitLock();
      }
    }
    const showOverlay = isActive && inGameplay && !isPortraitBlocked;
    root.classList.toggle('on', showOverlay);
    if (!showOverlay) {
      resetAllTouches();
    }
    if (isPortraitBlocked && inGameplay && !(G.params && G.params.shot)) {
      actions.onPause();
    }
  }

  function resetStick(keepLatch = false) {
    stickPointerId = null;
    inSprintLatchZone = false;
    latchZoneEnterMs = 0;
    if (!keepLatch) {
      isSprintLatched = false;
      stickMoveX = 0;
      stickMoveY = 0;
      stickMagnitude = 0;
      stickSprint = false;
      stickBaseEl.classList.remove('dragging', 'sprinting', 'latched');
      stickNubEl.style.transform = 'translate3d(0px, 0px, 0px)';
    } else {
      stickMoveX = 0;
      stickMoveY = 1;
      stickMagnitude = 1;
      stickSprint = true;
      stickBaseEl.classList.remove('dragging');
      stickBaseEl.classList.add('sprinting', 'latched');
      stickNubEl.style.transform = `translate3d(0px, ${(-STICK_MAX_RADIUS_PX).toFixed(1)}px, 0px)`;
    }
    stickBaseEl.style.left = '';
    stickBaseEl.style.top = '';
    stickBaseEl.style.bottom = '';
    stickBaseEl.style.transform = '';
    syncSprintLatchVisual();
  }

  function resetAllTouches() {
    resetStick(false);
    crouchToggled = false;
    syncCrouchVisual();
    lookPointers.clear();
    heldButtons.clear();
    lastGyroBeta = null;
    lastGyroGamma = null;
    root.querySelectorAll('.gt-btn.held').forEach((el) => el.classList.remove('held'));
  }

  // --- Left Dynamic Floating Virtual Joystick + Auto-Sprint Lock (`上滑锁定疾跑`) ---
  stickZoneEl.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!inGameplay) return;
    if (e.pointerType === 'touch') sawTouchEvent = true;
    actions.onAudioUnlock();
    if (stickPointerId !== null) return;
    e.preventDefault();
    e.stopPropagation();
    stickPointerId = e.pointerId;
    try {
      stickZoneEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer capture errors
    }

    // Touching the joystick again cancels any hands-free sprint lock cleanly (Peacekeeper Elite behavior)
    if (isSprintLatched) {
      isSprintLatched = false;
      pulseHaptic(5);
    }
    inSprintLatchZone = false;
    latchZoneEnterMs = 0;

    const zoneRect = stickZoneEl.getBoundingClientRect();
    stickOriginX = e.clientX;
    stickOriginY = e.clientY;
    stickTouchDownX = e.clientX;
    stickTouchDownY = e.clientY;
    const relX = stickOriginX - zoneRect.left;
    const relY = stickOriginY - zoneRect.top;
    stickBaseEl.classList.add('dragging');
    stickBaseEl.classList.remove('sprinting', 'latched');
    stickBaseEl.style.left = `${relX.toFixed(1)}px`;
    stickBaseEl.style.top = `${relY.toFixed(1)}px`;
    stickBaseEl.style.bottom = 'auto';
    stickNubEl.style.transform = 'translate3d(0px, 0px, 0px)';
    stickMoveX = 0;
    stickMoveY = 0;
    stickMagnitude = 0;
    stickSprint = false;
    syncSprintLatchVisual();
  });

  stickZoneEl.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerId !== stickPointerId) return;
    e.preventDefault();

    // Check upward Sprint-Latch gesture relative to initial touch-down anchor BEFORE floating origin pulls up!
    const rawFromDownDx = e.clientX - stickTouchDownX;
    const rawFromDownDy = e.clientY - stickTouchDownY;
    const curMs = nowMs();

    const probeLatch = computeSprintLatchState({
      dxPx: rawFromDownDx,
      dyPx: rawFromDownDy,
      maxRadiusPx: STICK_MAX_RADIUS_PX,
      holdInZoneSec: 0,
      wasLatched: isSprintLatched,
    });
    if (probeLatch.inLatchZone) {
      if (!inSprintLatchZone) {
        inSprintLatchZone = true;
        latchZoneEnterMs = curMs;
        pulseHaptic(6);
      }
    } else {
      inSprintLatchZone = false;
      latchZoneEnterMs = 0;
    }

    const holdSec = inSprintLatchZone && latchZoneEnterMs > 0 ? (curMs - latchZoneEnterMs) / 1000 : 0;
    const latchOut = computeSprintLatchState({
      dxPx: rawFromDownDx,
      dyPx: rawFromDownDy,
      maxRadiusPx: STICK_MAX_RADIUS_PX,
      holdInZoneSec: holdSec,
      holdThresholdSec: 0.16,
      wasLatched: isSprintLatched,
    });
    if (latchOut.sprintLocked && !isSprintLatched) {
      isSprintLatched = true;
      crouchToggled = false;
      syncCrouchVisual();
      pulseHaptic(10);
    } else if (!latchOut.sprintLocked && isSprintLatched) {
      isSprintLatched = false;
    }

    // Dynamic floating origin follow (disabled vertically while pushing into sprint-latch pill so the user feels the latch threshold!)
    if (!inSprintLatchZone) {
      const floated = computeFloatingStickOrigin({
        originX: stickOriginX,
        originY: stickOriginY,
        pointerX: e.clientX,
        pointerY: e.clientY,
        maxRadiusPx: STICK_MAX_RADIUS_PX,
        followSlackPx: STICK_FOLLOW_SLACK_PX,
      });
      if (floated.originX !== stickOriginX || floated.originY !== stickOriginY) {
        stickOriginX = floated.originX;
        stickOriginY = floated.originY;
        const zoneRect = stickZoneEl.getBoundingClientRect();
        stickBaseEl.style.left = `${(stickOriginX - zoneRect.left).toFixed(1)}px`;
        stickBaseEl.style.top = `${(stickOriginY - zoneRect.top).toFixed(1)}px`;
      }
    }

    const out = computeVirtualStick(
      e.clientX - stickOriginX,
      e.clientY - stickOriginY,
      STICK_MAX_RADIUS_PX,
      0.08
    );
    stickMoveX = out.moveX;
    stickMoveY = out.moveY;
    stickMagnitude = out.magnitude;
    stickSprint = out.sprint || isSprintLatched;
    if (stickSprint && crouchToggled) {
      crouchToggled = false;
      syncCrouchVisual();
    }
    stickBaseEl.classList.toggle('sprinting', stickSprint);
    const nubY = inSprintLatchZone ? -STICK_MAX_RADIUS_PX * 1.18 : out.nubY;
    stickNubEl.style.transform = `translate3d(${out.nubX.toFixed(1)}px, ${nubY.toFixed(1)}px, 0px)`;
    syncSprintLatchVisual();
  });

  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== stickPointerId) return;
    const rawFromDownDx = e.clientX - stickTouchDownX;
    const rawFromDownDy = e.clientY - stickTouchDownY;
    const releaseLatch = computeSprintLatchState({
      dxPx: rawFromDownDx,
      dyPx: rawFromDownDy,
      maxRadiusPx: STICK_MAX_RADIUS_PX,
      released: true,
      wasLatched: isSprintLatched,
    });
    if (releaseLatch.sprintLocked && !isSprintLatched) {
      pulseHaptic(10);
    }
    isSprintLatched = releaseLatch.sprintLocked;
    if (isSprintLatched) {
      crouchToggled = false;
      syncCrouchVisual();
    }
    resetStick(isSprintLatched);
  };
  stickZoneEl.addEventListener('pointerup', endStick);
  stickZoneEl.addEventListener('pointercancel', endStick);

  // --- Right Swipe-Look + Coalesced 120Hz Sampling + Firing Recoil-Control Stability ---
  function feedLookSample(ptr: LookPointerTrack, nextX: number, nextY: number, eventTimeMs: number) {
    if (!G.input || !inGameplay) return;
    const rawDxPx = nextX - ptr.x;
    const rawDyPx = nextY - ptr.y;
    const dtMs = ptr.lastTimeMs > 0 ? Math.max(2, Math.min(50, eventTimeMs - ptr.lastTimeMs)) : 16.67;
    ptr.x = nextX;
    ptr.y = nextY;
    ptr.lastTimeMs = eventTimeMs;

    if (Math.abs(rawDxPx) < 1e-4 && Math.abs(rawDyPx) < 1e-4) return;

    // Light EMA micro-jitter smoothing (`0.84` live + `0.16` previous velocity)
    const smoothDx = rawDxPx * 0.84 + ptr.vx * 0.16;
    const smoothDy = rawDyPx * 0.84 + ptr.vy * 0.16;
    ptr.vx = smoothDx;
    ptr.vy = smoothDy;

    const baseSens = G.input.sensitivity || 1;
    const effectiveSens = baseSens * touchSensitivity;
    const inv = !!G.input.invertY;
    const firingNow =
      isHeld('fire') ||
      isHeld('lfire') ||
      ptr.sourceBtn === 'fire' ||
      ptr.sourceBtn === 'lfire' ||
      !!G.input.fire;

    const d = computeProTouchLookDelta({
      deltaXPx: smoothDx,
      deltaYPx: smoothDy,
      dtMs,
      sensitivity: effectiveSens,
      firingSensScale: firingSensitivity,
      isFiring: firingNow,
      accelMode,
      invertY: inv,
    });
    G.input.look.dx += d.dx;
    G.input.look.dy += d.dy;
  }

  function processPointerMoveLook(e: PointerEvent) {
    const ptr = lookPointers.get(e.pointerId);
    if (!ptr) return;
    e.preventDefault();
    const coalesced =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (coalesced && coalesced.length > 1) {
      for (let i = 0; i < coalesced.length; i++) {
        const ce = coalesced[i];
        const tMs = typeof ce.timeStamp === 'number' && ce.timeStamp > 0 ? ce.timeStamp : nowMs();
        feedLookSample(ptr, ce.clientX, ce.clientY, tMs);
      }
    } else {
      const tMs = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : nowMs();
      feedLookSample(ptr, e.clientX, e.clientY, tMs);
    }
  }

  lookZoneEl.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!inGameplay) return;
    if (e.pointerType === 'touch') sawTouchEvent = true;
    actions.onAudioUnlock();
    e.preventDefault();
    try {
      lookZoneEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    lookPointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      vx: 0,
      vy: 0,
      lastTimeMs: typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : nowMs(),
      sourceBtn: null,
    });
  });

  lookZoneEl.addEventListener('pointermove', processPointerMoveLook);

  const endLook = (e: PointerEvent) => {
    lookPointers.delete(e.pointerId);
  };
  lookZoneEl.addEventListener('pointerup', endLook);
  lookZoneEl.addEventListener('pointercancel', endLook);

  // --- Gyroscope Fine-Aim (`和平精英 / 瓦罗兰特手游 陀螺仪辅助瞄准`) ---
  function getScreenAngleDeg(): number {
    if (typeof window === 'undefined') return 90;
    const scrOri = (typeof screen !== 'undefined' && (screen as any).orientation) || null;
    if (scrOri && typeof scrOri.angle === 'number') {
      return scrOri.angle;
    }
    const winOri = (window as any).orientation;
    if (typeof winOri === 'number') {
      return winOri;
    }
    return 90;
  }

  function onDeviceOrientation(ev: DeviceOrientationEvent) {
    if (!isActive || !inGameplay || isPortraitBlocked || gyroMode === 'off' || !G.input) {
      lastGyroBeta = null;
      lastGyroGamma = null;
      return;
    }
    if (ev.beta === null || ev.gamma === null) return;
    if (gyroMode === 'ads_fire' && !isHeld('fire') && !isHeld('lfire') && !G.input.fire) {
      lastGyroBeta = ev.beta;
      lastGyroGamma = ev.gamma;
      return;
    }
    if (lastGyroBeta === null || lastGyroGamma === null) {
      lastGyroBeta = ev.beta;
      lastGyroGamma = ev.gamma;
      return;
    }
    const dBeta = ev.beta - lastGyroBeta;
    const dGamma = ev.gamma - lastGyroGamma;
    lastGyroBeta = ev.beta;
    lastGyroGamma = ev.gamma;

    const gOut = computeGyroLookDelta({
      deltaBetaDeg: dBeta,
      deltaGammaDeg: dGamma,
      screenAngleDeg: getScreenAngleDeg(),
      gyroSensitivity,
      invertY: !!G.input.invertY,
    });
    G.input.look.dx += gOut.dx;
    G.input.look.dy += gOut.dy;
  }

  function ensureGyroListener() {
    if (gyroListenerAttached || typeof window === 'undefined') return;
    gyroListenerAttached = true;
    window.addEventListener('deviceorientation', onDeviceOrientation as EventListener, {
      passive: true,
    });
  }

  if (gyroMode !== 'off') {
    ensureGyroListener();
  }

  async function requestAndSetGyroMode(nextMode: TouchGyroMode): Promise<boolean> {
    if (nextMode === 'off') {
      gyroMode = 'off';
      lastGyroBeta = null;
      lastGyroGamma = null;
      try {
        localStorage.setItem(GYRO_MODE_KEY, 'off');
      } catch {
        // ignore
      }
      return true;
    }
    try {
      const DevOri =
        typeof window !== 'undefined' ? (window as any).DeviceOrientationEvent : undefined;
      if (DevOri && typeof DevOri.requestPermission === 'function') {
        const perm = await DevOri.requestPermission();
        if (perm !== 'granted') {
          return false;
        }
      }
    } catch {
      return false;
    }
    gyroMode = nextMode;
    lastGyroBeta = null;
    lastGyroGamma = null;
    ensureGyroListener();
    try {
      localStorage.setItem(GYRO_MODE_KEY, gyroMode);
    } catch {
      // ignore
    }
    return true;
  }

  // --- Action Cluster & Left-Fire Buttons (Universal Drag-to-Aim across Combat Buttons!) ---
  const dragAimButtons = new Set([
    'fire',
    'lfire',
    'fan',
    'jump',
    'crouch',
    'swift',
    'deflect',
    'ult',
    'melee',
    'reload',
  ]);

  root.querySelectorAll<HTMLButtonElement>('[data-btn]').forEach((btn) => {
    const key = btn.dataset.btn!;
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());

    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'touch') sawTouchEvent = true;
      actions.onAudioUnlock();
      e.preventDefault();
      e.stopPropagation();

      if (key === 'pause') {
        actions.onPause();
        return;
      }

      if (!inGameplay) return;

      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      let set = heldButtons.get(key);
      if (!set) {
        set = new Set();
        heldButtons.set(key, set);
      }
      set.add(e.pointerId);
      btn.classList.add('held');

      if (dragAimButtons.has(key)) {
        // Left index fire button (`lfire` in `claw3`) lets right thumb continue aiming independently;
        // dragging on `lfire` also tracks aim smoothly if used as primary thumb fire!
        lookPointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          vx: 0,
          vy: 0,
          lastTimeMs: typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : nowMs(),
          sourceBtn: key,
        });
      }

      switch (key) {
        case 'fire':
        case 'lfire':
          fireJustPressed = true;
          pulseHaptic(4);
          break;
        case 'fan':
          fanJustPressed = true;
          pulseHaptic(6);
          break;
        case 'jump':
          jumpJustPressed = true;
          if (crouchToggled) {
            crouchToggled = false;
            syncCrouchVisual();
          }
          break;
        case 'crouch':
          crouchToggled = !crouchToggled;
          if (crouchToggled && isSprintLatched) {
            isSprintLatched = false;
            resetStick(false);
          }
          pulseHaptic(5);
          syncCrouchVisual();
          break;
        case 'swift':
          pulseHaptic(8);
          actions.onSwiftStrike();
          break;
        case 'deflect':
          pulseHaptic(8);
          actions.onDeflect();
          break;
        case 'ult':
          pulseHaptic(14);
          actions.onDragonblade();
          break;
        case 'melee':
          meleeJustPressed = true;
          pulseHaptic(6);
          break;
        case 'reload':
          reloadJustPressed = true;
          pulseHaptic(5);
          break;
      }
    });

    btn.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragAimButtons.has(key)) return;
      processPointerMoveLook(e);
    });

    const releaseBtn = (e: PointerEvent) => {
      lookPointers.delete(e.pointerId);
      const set = heldButtons.get(key);
      if (set) {
        set.delete(e.pointerId);
        if (set.size === 0) {
          btn.classList.remove('held');
        }
      } else {
        btn.classList.remove('held');
      }
    };
    btn.addEventListener('pointerup', releaseBtn);
    btn.addEventListener('pointercancel', releaseBtn);
  });

  // Auto-detect first real touch anywhere on window & respond to viewport resize / orientation change
  window.addEventListener(
    'touchstart',
    () => {
      if (!sawTouchEvent) {
        sawTouchEvent = true;
        refreshVisibility();
      }
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !sawTouchEvent) {
        sawTouchEvent = true;
        refreshVisibility();
      }
    },
    { passive: true, capture: true }
  );

  const syncVisualViewportCssVars = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const vv = window.visualViewport;
    const w = Math.round(vv && vv.width ? vv.width : window.innerWidth || 1440);
    const h = Math.round(vv && vv.height ? vv.height : window.innerHeight || 900);
    const docStyle = document.documentElement && document.documentElement.style;
    if (docStyle && typeof docStyle.setProperty === 'function') {
      docStyle.setProperty('--app-w', `${w}px`);
      docStyle.setProperty('--app-h', `${h}px`);
    }
    if (isActive && typeof window.scrollTo === 'function' && (window.scrollX || window.scrollY)) {
      window.scrollTo(0, 0);
    }
  };

  window.addEventListener('resize', () => {
    syncVisualViewportCssVars();
    refreshVisibility();
  });
  window.addEventListener('orientationchange', () => {
    lastGyroBeta = null;
    lastGyroGamma = null;
    syncVisualViewportCssVars();
    refreshVisibility();
  });
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      syncVisualViewportCssVars();
      refreshVisibility();
    });
    window.visualViewport.addEventListener('scroll', () => {
      syncVisualViewportCssVars();
    });
  }

  syncVisualViewportCssVars();
  refreshVisibility();

  return {
    root,
    get active() {
      return isActive;
    },
    get portraitBlocked() {
      return isPortraitBlocked;
    },
    get stickMagnitude() {
      if (isSprintLatched) return 1;
      return stickPointerId !== null ? stickMagnitude : 0;
    },
    get sprintLocked() {
      return isSprintLatched;
    },
    get preference() {
      return preference;
    },
    setPreference(pref: TouchUiPreference) {
      preference = pref;
      try {
        localStorage.setItem(PREF_KEY, pref);
      } catch {
        // ignore
      }
      refreshVisibility();
    },
    get touchSensitivity() {
      return touchSensitivity;
    },
    setTouchSensitivity(sens: number) {
      touchSensitivity = Math.max(0.3, Math.min(2.5, Number.isFinite(sens) ? sens : 1.0));
      try {
        localStorage.setItem(TOUCH_SENS_KEY, touchSensitivity.toFixed(2));
      } catch {
        // ignore
      }
    },
    get firingSensitivity() {
      return firingSensitivity;
    },
    setFiringSensitivity(ratio: number) {
      firingSensitivity = Math.max(0.4, Math.min(1.4, Number.isFinite(ratio) ? ratio : 0.8));
      try {
        localStorage.setItem(FIRE_SENS_KEY, firingSensitivity.toFixed(2));
      } catch {
        // ignore
      }
    },
    get accelMode() {
      return accelMode;
    },
    setAccelMode(mode: TouchAccelMode) {
      accelMode = mode === 'linear' ? 'linear' : 'speed';
      try {
        localStorage.setItem(ACCEL_MODE_KEY, accelMode);
      } catch {
        // ignore
      }
    },
    get gyroMode() {
      return gyroMode;
    },
    setGyroMode: requestAndSetGyroMode,
    get gyroSensitivity() {
      return gyroSensitivity;
    },
    setGyroSensitivity(sens: number) {
      gyroSensitivity = Math.max(0.25, Math.min(2.5, Number.isFinite(sens) ? sens : 1.0));
      try {
        localStorage.setItem(GYRO_SENS_KEY, gyroSensitivity.toFixed(2));
      } catch {
        // ignore
      }
    },
    get layoutPreset() {
      return layoutPreset;
    },
    setLayoutPreset(preset: TouchLayoutPreset) {
      layoutPreset = preset === 'thumb2' ? 'thumb2' : 'claw3';
      root.dataset.layout = layoutPreset;
      try {
        localStorage.setItem(LAYOUT_PRESET_KEY, layoutPreset);
      } catch {
        // ignore
      }
    },
    get buttonOpacity() {
      return buttonOpacity;
    },
    setButtonOpacity(opacity: number) {
      buttonOpacity = Math.max(0.45, Math.min(1.0, Number.isFinite(opacity) ? opacity : 0.86));
      applyButtonOpacityCss();
      try {
        localStorage.setItem(BTN_OPACITY_KEY, buttonOpacity.toFixed(2));
      } catch {
        // ignore
      }
    },
    get aimAssistEnabled() {
      return aimAssistEnabled;
    },
    setAimAssistEnabled(enabled: boolean) {
      aimAssistEnabled = !!enabled;
      try {
        localStorage.setItem(AIM_ASSIST_KEY, aimAssistEnabled ? '1' : '0');
      } catch {
        // ignore
      }
    },
    setGameplayVisible(v: boolean) {
      inGameplay = !!v;
      refreshVisibility();
    },
    requestLandscapeLock,
    setInteractAvailable(available: boolean, progress = 0) {
      interactBtnEl.hidden = !available;
      if (available) {
        interactFillEl.style.transform = `scaleX(${clamp01(progress).toFixed(3)})`;
      }
    },
    isSprinting() {
      return isSprintLatched || (stickPointerId !== null && stickSprint);
    },
    isCrouching() {
      return crouchToggled;
    },
    setCrouching(crouched: boolean) {
      crouchToggled = !!crouched;
      syncCrouchVisual();
    },
    consumeJumpPressed() {
      const v = jumpJustPressed;
      jumpJustPressed = false;
      return v;
    },
    isJumpHeld() {
      return isHeld('jump');
    },
    consumeFanPressed() {
      const v = fanJustPressed;
      fanJustPressed = false;
      return v;
    },
    isFireHeld() {
      return isHeld('fire') || isHeld('lfire');
    },
    consumeFirePressed() {
      const v = fireJustPressed;
      fireJustPressed = false;
      return v;
    },
    consumeMeleePressed() {
      const v = meleeJustPressed;
      meleeJustPressed = false;
      return v;
    },
    consumeReloadPressed() {
      const v = reloadJustPressed;
      reloadJustPressed = false;
      return v;
    },
    isInteractHeld() {
      return isHeld('interact');
    },
    applyToInput() {
      if (!isActive || !inGameplay || !G.input) return;
      if (stickPointerId !== null) {
        const nx = G.input.move.x + stickMoveX;
        const ny = G.input.move.y + stickMoveY;
        const mag = Math.hypot(nx, ny);
        G.input.move.x = mag > 1 ? nx / mag : nx;
        G.input.move.y = mag > 1 ? ny / mag : ny;
        if (stickSprint) G.input.sprint = true;
      } else if (isSprintLatched) {
        G.input.move.y = 1;
        G.input.sprint = true;
      }
      if (crouchToggled && !G.input.sprint) {
        G.input.crouch = true;
      }
      if (isHeld('fire') || isHeld('lfire')) {
        G.input.fire = true;
      }
    },
    setHeroClass(hero: HeroClassId) {
      activeHero = hero;
      // Hide reload button for infinite-quiver Shimada Hanzo (`岛田半藏`)
      reloadBtnEl.hidden = hero === 'hanzo';
      if (hero === 'gunner') {
        ultMainEl.textContent = '镜';
        swiftMainEl.textContent = '疾';
        deflectMainEl.textContent = '疗';
        jumpMainEl.textContent = '跃';
        fanMainEl.textContent = '弹';
        if (fanSubEl) fanSubEl.textContent = '螺旋';
        fireLblEl.textContent = '射';
        lfireLblEl.textContent = '射';
        lfireSubEl.textContent = '左射';
      } else if (hero === 'hanzo') {
        ultMainEl.textContent = '龙';
        swiftMainEl.textContent = '音';
        deflectMainEl.textContent = '岚';
        jumpMainEl.textContent = '跃';
        fanMainEl.textContent = '收';
        if (fanSubEl) fanSubEl.textContent = '收弓';
        fireLblEl.textContent = '弓';
        lfireLblEl.textContent = '弓';
        lfireSubEl.textContent = '拉弓';
      } else {
        ultMainEl.textContent = '斩';
        swiftMainEl.textContent = '影';
        deflectMainEl.textContent = '闪';
        jumpMainEl.textContent = '灵';
        fanMainEl.textContent = '扇';
        if (fanSubEl) fanSubEl.textContent = '齐射';
        fireLblEl.textContent = '镖';
        lfireLblEl.textContent = '镖';
        lfireSubEl.textContent = '左火';
      }
    },
    syncVitals(hp: number, maxHp: number, ammoDisplay: string, isLowHp = false) {
      if (!isActive) return;
      const ratio = maxHp > 0 ? clamp01(hp / maxHp) : 0;
      if (hpFillEl) hpFillEl.style.transform = `scaleX(${ratio.toFixed(3)})`;
      if (hpValEl) hpValEl.textContent = `${Math.max(0, Math.ceil(hp))}`;
      if (ammoValEl) ammoValEl.textContent = ammoDisplay;
      if (hudBarEl) hudBarEl.classList.toggle('is-low', isLowHp || ratio <= 0.32);
    },
    syncHudState(
      cd: GenjiCooldownState,
      isWallClimbing: boolean,
      swiftResetFlash: boolean,
      ammo: number,
      magSize: number,
      swiftMaxCd = 7,
      deflectMaxCd = 8
    ) {
      if (!isActive || activeHero !== 'genji') return;

      const isDragon = cd.dragonActiveT > 0;
      const ultPct = Math.floor(cd.ultCharge);
      const ultReady = !isDragon && ultPct >= 100;

      ultBtnEl.classList.toggle('ready', ultReady);
      ultBtnEl.classList.toggle('active', isDragon);
      setRingProgress(
        ringUltEl,
        isDragon ? cd.dragonActiveT / Math.max(1, cd.dragonMaxT || 6) : ultPct / 100
      );
      ultPctEl.textContent = isDragon
        ? `${cd.dragonActiveT.toFixed(1)}s`
        : ultReady
          ? '拔刀!'
          : `${ultPct}%`;

      const swiftWait = cd.swiftCd > 0.05;
      swiftBtnEl.classList.toggle('cd', swiftWait);
      swiftBtnEl.classList.toggle('reset-flash', swiftResetFlash);
      setRingProgress(ringSwiftEl, swiftWait ? 1 - cd.swiftCd / Math.max(1, swiftMaxCd) : 1);
      swiftCdEl.textContent = swiftWait ? `${cd.swiftCd.toFixed(1)}s` : '就绪';

      const deflectOn = cd.deflectActiveT > 0;
      const deflectWait = !deflectOn && cd.deflectCd > 0.05;
      deflectBtnEl.classList.toggle('active', deflectOn);
      deflectBtnEl.classList.toggle('cd', deflectWait);
      setRingProgress(
        ringDeflectEl,
        deflectOn ? 1 : deflectWait ? 1 - cd.deflectCd / Math.max(1, deflectMaxCd) : 1
      );
      deflectCdEl.textContent = deflectOn
        ? `${cd.deflectActiveT.toFixed(1)}s`
        : deflectWait
          ? `${cd.deflectCd.toFixed(1)}s`
          : '就绪';

      jumpBtnEl.classList.toggle('active', isWallClimbing);
      jumpStEl.textContent = isWallClimbing ? '攀爬中' : '跳/爬';

      fanBtnEl.classList.toggle('dim', isDragon);
      setRingProgress(ringFanEl, isDragon ? 0 : 1);
      fireBtnEl.classList.toggle('dragon', isDragon);
      lfireBtnEl.classList.toggle('dragon', isDragon);
      fireLblEl.textContent = isDragon ? '突斩' : '镖';
      lfireLblEl.textContent = isDragon ? '斩' : '镖';
      fireSubEl.textContent = isDragon ? '龙刃' : `${ammo}/${magSize}`;
    },
    syncGunnerHudState(
      cd: GunnerCooldownState,
      ammo: number,
      magSize: number,
      helixMaxCd = 6,
      bioticMaxCd = 12
    ) {
      if (!isActive || activeHero !== 'gunner') return;

      const isVisor = cd.visorActiveT > 0;
      const ultPct = Math.floor(cd.ultCharge);
      const ultReady = !isVisor && ultPct >= 100;

      ultBtnEl.classList.toggle('ready', ultReady);
      ultBtnEl.classList.toggle('active', isVisor);
      setRingProgress(
        ringUltEl,
        isVisor ? cd.visorActiveT / Math.max(1, cd.visorMaxT || 6) : ultPct / 100
      );
      ultPctEl.textContent = isVisor
        ? `${cd.visorActiveT.toFixed(1)}s`
        : ultReady
          ? '锁定!'
          : `${ultPct}%`;

      swiftBtnEl.classList.remove('cd', 'reset-flash');
      swiftBtnEl.classList.toggle('active', cd.sprintActive);
      setRingProgress(ringSwiftEl, 1);
      swiftCdEl.textContent = cd.sprintActive ? '疾跑中' : '常驻';

      const bioOn = cd.bioticActiveT > 0;
      const bioWait = !bioOn && cd.bioticCd > 0.05;
      deflectBtnEl.classList.toggle('active', bioOn);
      deflectBtnEl.classList.toggle('cd', bioWait);
      setRingProgress(
        ringDeflectEl,
        bioOn ? 1 : bioWait ? 1 - cd.bioticCd / Math.max(1, bioticMaxCd) : 1
      );
      deflectCdEl.textContent = bioOn
        ? `${cd.bioticActiveT.toFixed(1)}s`
        : bioWait
          ? `${cd.bioticCd.toFixed(1)}s`
          : '就绪';

      const helixWait = cd.helixCd > 0.05;
      fanBtnEl.classList.toggle('dim', helixWait);
      setRingProgress(ringFanEl, helixWait ? 1 - cd.helixCd / Math.max(1, helixMaxCd) : 1);
      if (fanSubEl) fanSubEl.textContent = helixWait ? `${cd.helixCd.toFixed(1)}s` : '螺旋';

      jumpBtnEl.classList.remove('active');
      jumpStEl.textContent = '跳跃';

      fireBtnEl.classList.toggle('dragon', isVisor);
      lfireBtnEl.classList.toggle('dragon', isVisor);
      fireLblEl.textContent = isVisor ? '锁定射' : '射';
      lfireLblEl.textContent = '射';
      fireSubEl.textContent = `${ammo}/${magSize}`;
    },
    syncHanzoHudState(
      cd: HanzoCooldownState,
      isWallClimbing: boolean,
      sonicMaxCd = 9,
      stormMaxCd = 8
    ) {
      if (!isActive || activeHero !== 'hanzo') return;

      const isDragon = cd.dragonActiveT > 0;
      const ultPct = Math.floor(cd.ultCharge);
      const ultReady = !isDragon && ultPct >= 100;

      ultBtnEl.classList.toggle('ready', ultReady);
      ultBtnEl.classList.toggle('active', isDragon);
      setRingProgress(ringUltEl, isDragon ? cd.dragonActiveT / 5.5 : ultPct / 100);
      ultPctEl.textContent = isDragon
        ? `${cd.dragonActiveT.toFixed(1)}s`
        : ultReady
          ? '双龙!'
          : `${ultPct}%`;

      const sonicWait = !cd.sonicArmed && cd.sonicCd > 0.05;
      swiftBtnEl.classList.remove('reset-flash');
      swiftBtnEl.classList.toggle('active', cd.sonicArmed || cd.sonicActiveT > 0);
      swiftBtnEl.classList.toggle('cd', sonicWait);
      setRingProgress(ringSwiftEl, sonicWait ? 1 - cd.sonicCd / Math.max(1, sonicMaxCd) : 1);
      swiftCdEl.textContent = cd.sonicArmed
        ? '已搭箭'
        : sonicWait
          ? `${cd.sonicCd.toFixed(1)}s`
          : '就绪';

      const stormOn = cd.stormActiveT > 0 && cd.stormArrowsLeft > 0;
      const stormWait = !stormOn && cd.stormCd > 0.05;
      deflectBtnEl.classList.toggle('active', stormOn);
      deflectBtnEl.classList.toggle('cd', stormWait);
      setRingProgress(
        ringDeflectEl,
        stormOn ? 1 : stormWait ? 1 - cd.stormCd / Math.max(1, stormMaxCd) : 1
      );
      deflectCdEl.textContent = stormOn
        ? `×${cd.stormArrowsLeft}`
        : stormWait
          ? `${cd.stormCd.toFixed(1)}s`
          : '就绪';

      const lungeWait = cd.lungeCd > 0.05;
      jumpBtnEl.classList.toggle('active', isWallClimbing);
      jumpStEl.textContent = isWallClimbing
        ? '攀爬中'
        : lungeWait
          ? `${cd.lungeCd.toFixed(1)}s`
          : '跃/爬';

      fanBtnEl.classList.toggle('dim', cd.drawRatio <= 0.02);
      setRingProgress(ringFanEl, cd.drawRatio);
      fireBtnEl.classList.toggle('dragon', stormOn);
      lfireBtnEl.classList.toggle('dragon', stormOn);
      fireLblEl.textContent = stormOn ? '岚矢' : cd.drawRatio > 0.05 ? '蓄力' : '弓';
      lfireLblEl.textContent = stormOn ? '岚' : '弓';
      fireSubEl.textContent = stormOn
        ? `余${cd.stormArrowsLeft}`
        : `${Math.round(cd.drawRatio * 100)}%`;
    },
  };
}
