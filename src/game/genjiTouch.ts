/**
 * Tri-Hero Mobile & Multi-Touch Controller (`花村 · 源氏 / 半藏 / 枪兵 横版双摇杆触控系统`)
 *
 * Features:
 * - Multi-finger simultaneous tracking via Pointer Events (`touch-action: none`):
 *   - Left-zone Dynamic Floating Thumbstick (`computeFloatingStickOrigin` + `0.08` deadzone + smooth auto-sprint)
 *   - Upper-left Secondary Fire Trigger (`左食指开火键` `.gt-lfire`) for claw / two-thumb uninterrupted aiming
 *   - Right-zone Calibrated Radian Dual-Slope Swipe Look + Drag-to-Aim across EVERY action button (zero dead zones!)
 * - Dedicated Action Arc Cluster (all hitboxes >= 48x48px native, zero CSS shrink-scaling):
 *   - `镖 / 弓 / 射` (Primary Fire / Bow Draw / Dragonblade Slash, 80x80px anchor)
 *   - `扇 / 收 / 弹` (Secondary Volley / Cancel Draw / Helix Rockets)
 *   - `灵 / 跃` (Jump / Double-Jump / Directional Lunge / Hold-to-Wall-Climb)
 *   - `影 / 音 / 疾` (`Shift` Mobility / Sonic Arrow / Tactical Sprint)
 *   - `闪 / 岚 / 疗` (`E` Deflect / Storm Arrows / Biotic Field)
 *   - `斩 / 龙 / 镜` (`Q` Ultimate with live % charge & ready pulse)
 *   - `刃` (Quick Melee) & `装` (Reload — automatically hidden on Hanzo)
 */

import {
  clamp01,
  computeFloatingStickOrigin,
  computeTouchLookDelta,
  computeVirtualStick,
  isPortraitViewportBlocked,
  shouldEnableTouchUi,
  type GenjiCooldownState,
  type GunnerCooldownState,
  type HanzoCooldownState,
  type HeroClassId,
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
  preference: TouchUiPreference;
  touchSensitivity: number;
  aimAssistEnabled: boolean;
  setPreference: (pref: TouchUiPreference) => void;
  setTouchSensitivity: (sens: number) => void;
  setAimAssistEnabled: (enabled: boolean) => void;
  setGameplayVisible: (inGameplay: boolean) => void;
  requestLandscapeLock: () => void;
  setInteractAvailable: (available: boolean, progress?: number) => void;
  isSprinting: () => boolean;
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
  syncHudState: (
    cd: GenjiCooldownState,
    isWallClimbing: boolean,
    swiftResetFlash: boolean,
    ammo: number,
    magSize: number
  ) => void;
  syncGunnerHudState: (
    cd: GunnerCooldownState,
    ammo: number,
    magSize: number
  ) => void;
  syncHanzoHudState: (
    cd: HanzoCooldownState,
    isWallClimbing: boolean
  ) => void;
}

const PREF_KEY = 'shimada_genji_touch_pref_v1';
const TOUCH_SENS_KEY = 'shimada_touch_sens_v1';
const AIM_ASSIST_KEY = 'shimada_touch_aim_assist_v1';

export function createGenjiTouchController(
  G: any,
  uiRoot: HTMLElement,
  actions: GenjiTouchActions
): GenjiTouchController {
  let preference: TouchUiPreference = 'auto';
  let touchSensitivity = 1.0;
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

  // Virtual thumbstick state (with dynamic floating origin follow)
  const STICK_MAX_RADIUS_PX = 40;
  const STICK_FOLLOW_SLACK_PX = 6;
  let stickPointerId: number | null = null;
  let stickOriginX = 0;
  let stickOriginY = 0;
  let stickMoveX = 0;
  let stickMoveY = 0;
  let stickMagnitude = 0;
  let stickSprint = false;

  // Look swipe state (supports open screen AND drag-through aiming on ALL right-hand buttons!)
  const lookPointers = new Map<number, { x: number; y: number; vx: number; vy: number }>();

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

  // Build ergonomic landscape mobile overlay DOM
  const root = document.createElement('div');
  root.id = 'g-touch';
  root.className = 'g-touch';
  root.setAttribute('aria-label', '移动端双摇杆触控面板');
  root.innerHTML = `
    <div class="gt-stick-zone" data-zone="stick" aria-label="动态移动摇杆区">
      <div class="gt-stick">
        <div class="gt-stick-ring"></div>
        <div class="gt-stick-nub"></div>
      </div>
    </div>

    <div class="gt-look-zone" data-zone="look" aria-label="滑动转向瞄准区"></div>

    <button type="button" class="gt-btn gt-lfire" data-btn="lfire" aria-label="左手辅助开火键">
      <span class="gt-main" data-f="lfire-lbl">镖</span>
      <span class="gt-sub" data-f="lfire-sub">副火</span>
    </button>

    <button type="button" class="gt-btn gt-pause" data-btn="pause" aria-label="暂停与设置">
      <span class="gt-ico">||</span>
      <span class="gt-txt">暂停</span>
    </button>

    <button type="button" class="gt-btn gt-interact" data-btn="interact" hidden aria-label="净化龙脉神龛">
      <span class="gt-int-fill"></span>
      <span class="gt-txt">按住 · 净化神龛</span>
    </button>

    <div class="gt-cluster" aria-label="技能与主武器弧形操作区">
      <button type="button" class="gt-btn gt-ult" data-btn="ult" aria-label="终极奥义技能">
        <span class="gt-main">斩</span>
        <span class="gt-sub" data-f="ult-pct">0%</span>
      </button>

      <button type="button" class="gt-btn gt-skill gt-swift" data-btn="swift" aria-label="身法或侦察技能">
        <span class="gt-main">影</span>
        <span class="gt-sub" data-f="swift-cd">就绪</span>
      </button>

      <button type="button" class="gt-btn gt-skill gt-deflect" data-btn="deflect" aria-label="核心战术技能">
        <span class="gt-main">闪</span>
        <span class="gt-sub" data-f="deflect-cd">就绪</span>
      </button>

      <button type="button" class="gt-btn gt-jump" data-btn="jump" aria-label="跳跃、二段跳、跃步与爬墙">
        <span class="gt-main">灵</span>
        <span class="gt-sub" data-f="jump-st">跳/爬</span>
      </button>

      <button type="button" class="gt-btn gt-fan" data-btn="fan" aria-label="副武器齐射或收弓">
        <span class="gt-main">扇</span>
        <span class="gt-sub">齐射</span>
      </button>

      <button type="button" class="gt-btn gt-fire" data-btn="fire" aria-label="主武器开火或蓄力">
        <span class="gt-main" data-f="fire-lbl">镖</span>
        <span class="gt-sub" data-f="fire-sub">24</span>
      </button>

      <button type="button" class="gt-btn gt-mini gt-melee" data-btn="melee" aria-label="近战快斩">
        <span class="gt-main">刃</span>
      </button>

      <button type="button" class="gt-btn gt-mini gt-reload" data-btn="reload" aria-label="装填弹药">
        <span class="gt-main">装</span>
      </button>
    </div>
  `;
  uiRoot.appendChild(root);

  const stickZoneEl = root.querySelector('.gt-stick-zone') as HTMLElement;
  const stickBaseEl = root.querySelector('.gt-stick') as HTMLElement;
  const stickNubEl = root.querySelector('.gt-stick-nub') as HTMLElement;
  const lookZoneEl = root.querySelector('.gt-look-zone') as HTMLElement;
  const interactBtnEl = root.querySelector('.gt-interact') as HTMLButtonElement;
  const interactFillEl = root.querySelector('.gt-int-fill') as HTMLElement;

  const lfireBtnEl = root.querySelector('.gt-lfire') as HTMLButtonElement;
  const lfireLblEl = root.querySelector('[data-f="lfire-lbl"]') as HTMLElement;
  const lfireSubEl = root.querySelector('[data-f="lfire-sub"]') as HTMLElement;

  const ultBtnEl = root.querySelector('.gt-ult') as HTMLButtonElement;
  const ultPctEl = root.querySelector('[data-f="ult-pct"]') as HTMLElement;
  const swiftBtnEl = root.querySelector('.gt-swift') as HTMLButtonElement;
  const swiftCdEl = root.querySelector('[data-f="swift-cd"]') as HTMLElement;
  const deflectBtnEl = root.querySelector('.gt-deflect') as HTMLButtonElement;
  const deflectCdEl = root.querySelector('[data-f="deflect-cd"]') as HTMLElement;
  const jumpBtnEl = root.querySelector('.gt-jump') as HTMLButtonElement;
  const jumpStEl = root.querySelector('[data-f="jump-st"]') as HTMLElement;
  const fanBtnEl = root.querySelector('.gt-fan') as HTMLButtonElement;
  const fireBtnEl = root.querySelector('.gt-fire') as HTMLButtonElement;
  const fireLblEl = root.querySelector('[data-f="fire-lbl"]') as HTMLElement;
  const fireSubEl = root.querySelector('[data-f="fire-sub"]') as HTMLElement;
  const reloadBtnEl = root.querySelector('.gt-reload') as HTMLButtonElement;

  const ultMainEl = ultBtnEl.querySelector('.gt-main') as HTMLElement;
  const swiftMainEl = swiftBtnEl.querySelector('.gt-main') as HTMLElement;
  const deflectMainEl = deflectBtnEl.querySelector('.gt-main') as HTMLElement;
  const jumpMainEl = jumpBtnEl.querySelector('.gt-main') as HTMLElement;
  const fanMainEl = fanBtnEl.querySelector('.gt-main') as HTMLElement;
  const fanSubEl = fanBtnEl.querySelector('.gt-sub') as HTMLElement;
  let activeHero: HeroClassId = 'genji';

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

  function resetStick() {
    stickPointerId = null;
    stickMoveX = 0;
    stickMoveY = 0;
    stickMagnitude = 0;
    stickSprint = false;
    stickBaseEl.classList.remove('dragging', 'sprinting');
    stickBaseEl.style.transform = '';
    stickNubEl.style.transform = 'translate3d(0px, 0px, 0px)';
  }

  function resetAllTouches() {
    resetStick();
    lookPointers.clear();
    heldButtons.clear();
    root.querySelectorAll('.gt-btn.held').forEach((el) => el.classList.remove('held'));
  }

  // --- Left Dynamic Floating Virtual Joystick Pointer Handling ---
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
    const zoneRect = stickZoneEl.getBoundingClientRect();
    stickOriginX = e.clientX;
    stickOriginY = e.clientY;
    const relX = stickOriginX - zoneRect.left;
    const relY = stickOriginY - zoneRect.top;
    stickBaseEl.classList.add('dragging');
    stickBaseEl.classList.remove('sprinting');
    stickBaseEl.style.left = `${relX.toFixed(1)}px`;
    stickBaseEl.style.top = `${relY.toFixed(1)}px`;
    stickBaseEl.style.bottom = 'auto';
    stickNubEl.style.transform = 'translate3d(0px, 0px, 0px)';
    stickMoveX = 0;
    stickMoveY = 0;
    stickMagnitude = 0;
    stickSprint = false;
  });

  stickZoneEl.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerId !== stickPointerId) return;
    e.preventDefault();

    // Dynamic floating origin follow: zero dead-travel when reversing strafe direction!
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

    const out = computeVirtualStick(
      e.clientX - stickOriginX,
      e.clientY - stickOriginY,
      STICK_MAX_RADIUS_PX,
      0.08
    );
    stickMoveX = out.moveX;
    stickMoveY = out.moveY;
    stickMagnitude = out.magnitude;
    stickSprint = out.sprint;
    stickBaseEl.classList.toggle('sprinting', stickSprint);
    stickNubEl.style.transform = `translate3d(${out.nubX.toFixed(1)}px, ${out.nubY.toFixed(1)}px, 0px)`;
  });

  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== stickPointerId) return;
    stickBaseEl.style.left = '';
    stickBaseEl.style.top = '';
    stickBaseEl.style.bottom = '';
    resetStick();
  };
  stickZoneEl.addEventListener('pointerup', endStick);
  stickZoneEl.addEventListener('pointercancel', endStick);

  // --- Right Swipe-Look Handling (Calibrated Radian Curve + Micro-Jitter Filter) ---
  function feedLookDelta(pointerId: number, rawDxPx: number, rawDyPx: number) {
    if (!G.input || !inGameplay) return;
    const ptr = lookPointers.get(pointerId);
    let smoothDx = rawDxPx;
    let smoothDy = rawDyPx;
    if (ptr) {
      smoothDx = rawDxPx * 0.8 + ptr.vx * 0.2;
      smoothDy = rawDyPx * 0.8 + ptr.vy * 0.2;
      ptr.vx = smoothDx;
      ptr.vy = smoothDy;
    }
    const baseSens = G.input.sensitivity || 1;
    const effectiveSens = baseSens * touchSensitivity;
    const inv = !!G.input.invertY;
    const d = computeTouchLookDelta(smoothDx, smoothDy, effectiveSens, inv);
    G.input.look.dx += d.dx;
    G.input.look.dy += d.dy;
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
    lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, vx: 0, vy: 0 });
  });

  lookZoneEl.addEventListener('pointermove', (e: PointerEvent) => {
    const prev = lookPointers.get(e.pointerId);
    if (!prev) return;
    e.preventDefault();
    feedLookDelta(e.pointerId, e.clientX - prev.x, e.clientY - prev.y);
    prev.x = e.clientX;
    prev.y = e.clientY;
  });

  const endLook = (e: PointerEvent) => {
    lookPointers.delete(e.pointerId);
  };
  lookZoneEl.addEventListener('pointerup', endLook);
  lookZoneEl.addEventListener('pointercancel', endLook);

  // --- Action Cluster & Left-Fire Buttons (Universal Drag-to-Aim across ALL Combat Buttons!) ---
  const dragAimButtons = new Set([
    'fire',
    'lfire',
    'fan',
    'jump',
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
        lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, vx: 0, vy: 0 });
      }

      switch (key) {
        case 'fire':
        case 'lfire':
          fireJustPressed = true;
          break;
        case 'fan':
          fanJustPressed = true;
          pulseHaptic(6);
          break;
        case 'jump':
          jumpJustPressed = true;
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
          break;
      }
    });

    btn.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragAimButtons.has(key)) return;
      const prev = lookPointers.get(e.pointerId);
      if (!prev) return;
      e.preventDefault();
      feedLookDelta(e.pointerId, e.clientX - prev.x, e.clientY - prev.y);
      prev.x = e.clientX;
      prev.y = e.clientY;
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

  // Auto-detect first real touch anywhere on window & respond to viewport resize / orientation change!
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

  window.addEventListener('resize', () => {
    refreshVisibility();
  });
  window.addEventListener('orientationchange', () => {
    refreshVisibility();
  });

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
      return stickPointerId !== null ? stickMagnitude : 0;
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
      return stickPointerId !== null && stickSprint;
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
      }
      if (isHeld('fire') || isHeld('lfire')) {
        G.input.fire = true;
      }
    },
    setHeroClass(hero: HeroClassId) {
      activeHero = hero;
      // Hide useless reload button for infinite-quiver Shimada Hanzo (`岛田半藏`)
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
        lfireSubEl.textContent = '连射';
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
        lfireSubEl.textContent = '副火';
      }
    },
    syncHudState(
      cd: GenjiCooldownState,
      isWallClimbing: boolean,
      swiftResetFlash: boolean,
      ammo: number,
      magSize: number
    ) {
      if (!isActive || activeHero !== 'genji') return;

      const isDragon = cd.dragonActiveT > 0;
      const ultPct = Math.floor(cd.ultCharge);
      const ultReady = !isDragon && ultPct >= 100;

      ultBtnEl.classList.toggle('ready', ultReady);
      ultBtnEl.classList.toggle('active', isDragon);
      ultPctEl.textContent = isDragon
        ? `${cd.dragonActiveT.toFixed(1)}s`
        : ultReady
          ? '拔刀!'
          : `${ultPct}%`;

      const swiftWait = cd.swiftCd > 0.05;
      swiftBtnEl.classList.toggle('cd', swiftWait);
      swiftBtnEl.classList.toggle('reset-flash', swiftResetFlash);
      swiftCdEl.textContent = swiftWait ? `${cd.swiftCd.toFixed(1)}s` : '就绪';

      const deflectOn = cd.deflectActiveT > 0;
      const deflectWait = !deflectOn && cd.deflectCd > 0.05;
      deflectBtnEl.classList.toggle('active', deflectOn);
      deflectBtnEl.classList.toggle('cd', deflectWait);
      deflectCdEl.textContent = deflectOn
        ? `${cd.deflectActiveT.toFixed(1)}s`
        : deflectWait
          ? `${cd.deflectCd.toFixed(1)}s`
          : '就绪';

      jumpBtnEl.classList.toggle('active', isWallClimbing);
      jumpStEl.textContent = isWallClimbing ? '攀爬中' : '跳/爬';

      fanBtnEl.classList.toggle('dim', isDragon);
      fireBtnEl.classList.toggle('dragon', isDragon);
      lfireBtnEl.classList.toggle('dragon', isDragon);
      fireLblEl.textContent = isDragon ? '突斩' : '镖';
      lfireLblEl.textContent = isDragon ? '斩' : '镖';
      fireSubEl.textContent = isDragon ? '龙刃' : `${ammo}/${magSize}`;
    },
    syncGunnerHudState(
      cd: GunnerCooldownState,
      ammo: number,
      magSize: number
    ) {
      if (!isActive || activeHero !== 'gunner') return;

      const isVisor = cd.visorActiveT > 0;
      const ultPct = Math.floor(cd.ultCharge);
      const ultReady = !isVisor && ultPct >= 100;

      ultBtnEl.classList.toggle('ready', ultReady);
      ultBtnEl.classList.toggle('active', isVisor);
      ultPctEl.textContent = isVisor
        ? `${cd.visorActiveT.toFixed(1)}s`
        : ultReady
          ? '锁定!'
          : `${ultPct}%`;

      swiftBtnEl.classList.remove('cd', 'reset-flash');
      swiftBtnEl.classList.toggle('active', cd.sprintActive);
      swiftCdEl.textContent = cd.sprintActive ? '疾跑中' : '常驻';

      const bioOn = cd.bioticActiveT > 0;
      const bioWait = !bioOn && cd.bioticCd > 0.05;
      deflectBtnEl.classList.toggle('active', bioOn);
      deflectBtnEl.classList.toggle('cd', bioWait);
      deflectCdEl.textContent = bioOn
        ? `${cd.bioticActiveT.toFixed(1)}s`
        : bioWait
          ? `${cd.bioticCd.toFixed(1)}s`
          : '就绪';

      const helixWait = cd.helixCd > 0.05;
      fanBtnEl.classList.toggle('dim', helixWait);
      if (fanSubEl) fanSubEl.textContent = helixWait ? `${cd.helixCd.toFixed(1)}s` : '螺旋';

      jumpBtnEl.classList.remove('active');
      jumpStEl.textContent = '跳跃';

      fireBtnEl.classList.toggle('dragon', isVisor);
      lfireBtnEl.classList.toggle('dragon', isVisor);
      fireLblEl.textContent = isVisor ? '锁定射' : '射';
      lfireLblEl.textContent = '射';
      fireSubEl.textContent = `${ammo}/${magSize}`;
    },
    syncHanzoHudState(cd: HanzoCooldownState, isWallClimbing: boolean) {
      if (!isActive || activeHero !== 'hanzo') return;

      const isDragon = cd.dragonActiveT > 0;
      const ultPct = Math.floor(cd.ultCharge);
      const ultReady = !isDragon && ultPct >= 100;

      ultBtnEl.classList.toggle('ready', ultReady);
      ultBtnEl.classList.toggle('active', isDragon);
      ultPctEl.textContent = isDragon
        ? `${cd.dragonActiveT.toFixed(1)}s`
        : ultReady
          ? '双龙!'
          : `${ultPct}%`;

      const sonicWait = !cd.sonicArmed && cd.sonicCd > 0.05;
      swiftBtnEl.classList.remove('reset-flash');
      swiftBtnEl.classList.toggle('active', cd.sonicArmed || cd.sonicActiveT > 0);
      swiftBtnEl.classList.toggle('cd', sonicWait);
      swiftCdEl.textContent = cd.sonicArmed
        ? '已搭箭'
        : sonicWait
          ? `${cd.sonicCd.toFixed(1)}s`
          : '就绪';

      const stormOn = cd.stormActiveT > 0 && cd.stormArrowsLeft > 0;
      const stormWait = !stormOn && cd.stormCd > 0.05;
      deflectBtnEl.classList.toggle('active', stormOn);
      deflectBtnEl.classList.toggle('cd', stormWait);
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
