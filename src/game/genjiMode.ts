/**
 * Genji (`岛田源氏`) Classical Shinobi Mobility, Swift Strike, Swept-Segment Deflect,
 * Tamahagane Dragonblade, Destructible Village Combat Integration, Sengoku Enemy Archetypes,
 * Sim-Level Hitstop + Dynamic FOV Surge, and 3-Choice Secret Scroll Roguelike Survival Controller.
 */

import {
  GUNNER_ARCHETYPE_LABELS,
  HANZO_ARCHETYPE_LABELS,
  UPGRADE_CATALOG,
  addUltimateDamageCharge,
  applyGenjiEliminationReset,
  applyHanzoEliminationReset,
  canSwitchHeroInState,
  checkSweptBoltDeflect,
  clamp01,
  clampActorToAirWall,
  computeDeflectDirection,
  computeEnemyLocatorInfo,
  computeGenjiBuildStats,
  computeGunnerBuildStats,
  computeHanzoBuildStats,
  computeHeroViewmodelVisibility,
  computeProjectileVisualScale,
  computeShieldedEnemyDamage,
  computeSniperLaserSegment,
  computeTouchAimAssist,
  computeWavePlan,
  createBaseGenjiStats,
  createBaseGunnerStats,
  createBaseHanzoStats,
  createColossalBossState,
  draftUpgradeChoices,
  isProjectileOutOfPlayableBounds,
  resolveUpgradeCardForHero,
  stepColossalBossDamage,
  stepCyberAgility,
  type ColossalBossState,
  type CyberAgilityState,
  type GenjiBuildStats,
  type GenjiCooldownState,
  type GenjiEnemyVariant,
  type GenjiUpgradeCard,
  type GunnerCooldownState,
  type GunnerStats,
  type HanzoCooldownState,
  type HanzoStats,
  type HeroClassId,
  type TouchAimCandidate,
  type TouchUiPreference,
  type UpgradeArchetype,
  type UpgradeRarity,
  type VisorCandidate,
} from './roguelike.ts';
import {
  clamp,
  computeBipedalGaitPose,
  computeMultiLegGaitPose,
  computeWaveDirectionLabel,
  createRng,
  damp,
  formatTime,
} from './rules.ts';
import {
  PROJECTILE_KIND,
  type EcsCombatBridge,
} from './ecsCombatBridge.ts';
import {
  createCombatFeelVfx,
  type CombatFeelVfxController,
} from './combatFeelVfx.ts';
import { createGenjiAudio, type GenjiAudioController } from './genjiAudio.ts';
import { createGenjiWeapon } from './genjiWeapon.ts';
import { createGunnerWeapon } from './gunnerWeapon.ts';
import { createHanzoWeapon } from './hanzoWeapon.ts';
import { createGenjiTouchController } from './genjiTouch.ts';
import {
  applyKarakuriSamuraiRig,
  buildMasterworkMortarCrabRig,
  buildMasterworkShieldGuardAttachment,
  buildMasterworkSpiderMechRig,
  getEnemyPbrSuite,
  getEnemyPoolDiagnostics,
  prewarmEnemyVariantPools,
  setBaseEnemySkinnedMeshVisible,
} from './enemyModels.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DeflectedSpear {
  active: boolean;
  originPos: any;
  pos: any;
  dir: any;
  speed: number;
  damage: number;
  life: number;
  traveledDist: number;
  homing: boolean;
}

const ARCHETYPE_LABELS: Record<UpgradeArchetype, string> = {
  shuriken: '风魔忍具',
  mobility: '疾风身法',
  deflect: '心眼水月',
  dragon: '龙神奥义',
};

const RARITY_LABELS: Record<UpgradeRarity, string> = {
  common: '凡品',
  rare: '秘传',
  legendary: '奥义',
};

export function installGenjiRoguelikeMode(G: any, menuFactory: (g: any, handlers: any) => any) {
  const THREE = G.THREE;
  const rng = createRng(+(G.params && G.params.seed ? G.params.seed : 4207) ^ 0x9e3779b9);
  const audio: GenjiAudioController = createGenjiAudio(!!(G.params && G.params.noaudio));

  // Pre-allocate & attach enemy procedural variant rigs onto the pooled actor slots at boot (Zero-GC wave spawns)
  prewarmEnemyVariantPools(G);

  // --- Active Hero Class (`genji` | `hanzo` | `gunner`) & Upgrade Stacks ---
  let activeHero: HeroClassId =
    G.params && G.params.hero === 'gunner'
      ? 'gunner'
      : G.params && G.params.hero === 'hanzo'
        ? 'hanzo'
        : 'genji';
  document.body.dataset.hero = activeHero;

  let upgradeStacks: Record<string, number> = {};
  let buildStats: GenjiBuildStats = createBaseGenjiStats();
  let gunnerStats: GunnerStats = createBaseGunnerStats();
  let hanzoStats: HanzoStats = createBaseHanzoStats();
  let totalUpgradesPicked = 0;

  const catalogMap = new Map<string, GenjiUpgradeCard>();
  for (const item of UPGRADE_CATALOG) {
    catalogMap.set(item.id, item);
  }

  const initialUlt = G.params && G.params.ult ? clamp(+G.params.ult, 0, 100) : 25;

  const cdState: GenjiCooldownState = {
    swiftCd: 0,
    deflectCd: 0,
    deflectActiveT: 0,
    ultCharge: initialUlt,
    dragonActiveT: 0,
    dragonMaxT: buildStats.dragonbladeDuration,
    dragonExtendsUsed: 0,
  };

  const gunnerCd: GunnerCooldownState = {
    helixCd: 0,
    bioticCd: 0,
    bioticActiveT: 0,
    sprintActive: false,
    ultCharge: initialUlt,
    visorActiveT: 0,
    visorMaxT: gunnerStats.visorDuration,
    visorExtendsUsed: 0,
    maxVisorExtensions: gunnerStats.maxVisorExtensions,
  };
  const bioticCenter = new THREE.Vector3();
  let bioticHealFrac = 0;

  const hanzoCd: HanzoCooldownState = {
    sonicCd: 0,
    sonicArmed: false,
    sonicActiveT: 0,
    stormCd: 0,
    stormActiveT: 0,
    stormArrowsLeft: 0,
    lungeCd: 0,
    ultCharge: initialUlt,
    dragonActiveT: 0,
    drawRatio: 0,
  };
  let hanzoLungeChargesLeft = hanzoStats.maxAirJumps;

  const agilityState: CyberAgilityState = {
    airJumpsLeft: buildStats.maxAirJumps,
    wallClimbTimeLeft: buildStats.wallClimbDuration,
    isWallClimbing: false,
  };

  // --- Sim-Level Hitstop, Dynamic Camera FOV Surge & Parry Feedback ---
  let hitstopT = 0;
  let fovKick = 0;
  let currentDynamicFov = 75;
  let parryStreakCount = 0;
  let parryBannerT = 0;

  // --- Active Dash (Swift Strike · Shift) & Dragonblade Forward Lunge (Q + LMB) State ---
  let dashActiveT = 0;
  let dashGraceT = 0;
  const dashDir = new THREE.Vector3();
  const dashStartPos = new THREE.Vector3();
  const dashHitIds = new Set<number>();
  let swiftResetFlashT = 0;
  let climbStepSoundT = 0;

  let dragonLungeActiveT = 0;
  const dragonLungeDur = 0.115;
  let dragonLungeRange = 7.6;
  const dragonLungeDir = new THREE.Vector3();
  const dragonLungeStart = new THREE.Vector3();
  const dragonLungeHitIds = new Set<number>();

  // --- Dedicated Ability Key Edge Tracker ---
  const abilityHeld = new Set<string>();
  const abilityPressed = new Set<string>();

  const onKeyDown = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;

    // Title screen Enter / Space quick-start handshake
    if (gameApi.state === 'title' && !menus.panelOpen && (ev.code === 'Enter' || ev.code === 'Space')) {
      ev.preventDefault();
      startNewRun({});
      return;
    }

    // 3-Choice Secret Scroll Modal Hotkeys: 1 / 2 / 3
    if (upgradeOpen) {
      if (ev.code === 'Digit1' || ev.code === 'Numpad1') {
        ev.preventDefault();
        chooseUpgrade(0);
      } else if (ev.code === 'Digit2' || ev.code === 'Numpad2') {
        ev.preventDefault();
        chooseUpgrade(1);
      } else if (ev.code === 'Digit3' || ev.code === 'Numpad3') {
        ev.preventDefault();
        chooseUpgrade(2);
      }
      return;
    }

    // Prevent Tab from stealing browser focus onto HUD buttons during active gameplay!
    if (
      ev.code === 'Tab' &&
      !upgradeOpen &&
      (gameApi.state === 'playing' || gameApi.state === 'intro')
    ) {
      ev.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.blur();
      }
    }

    if (!ev.repeat) {
      if (!abilityHeld.has(ev.code)) {
        abilityHeld.add(ev.code);
        abilityPressed.add(ev.code);
      }
    }
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    abilityHeld.delete(ev.code);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    abilityHeld.clear();
    abilityPressed.clear();
  });

  const consumeKey = (codes: string[]): boolean => {
    for (const c of codes) {
      if (abilityPressed.has(c)) {
        abilityPressed.delete(c);
        return true;
      }
    }
    return false;
  };

  const isKeyHeld = (codes: string[]): boolean => {
    for (const c of codes) {
      if (abilityHeld.has(c)) return true;
    }
    return false;
  };

  // --- Install Tri-Hero Mobile Multi-Touch Controller (`g-touch`) ---
  const uiRootEarly = document.getElementById('ui')!;
  const touchCtrl = createGenjiTouchController(G, uiRootEarly, {
    onSwiftStrike: () => {
      if (activeHero === 'gunner') toggleGunnerSprint();
      else if (activeHero === 'hanzo') toggleSonicArrow();
      else tryCastSwiftStrike();
    },
    onDeflect: () => {
      if (activeHero === 'gunner') tryCastBioticField();
      else if (activeHero === 'hanzo') activateStormArrows();
      else tryCastDeflect();
    },
    onDragonblade: () => {
      if (activeHero === 'gunner') tryCastTacticalVisor();
      else if (activeHero === 'hanzo') tryCastDragonstrike();
      else tryCastDragonblade();
    },
    onPause: () => pauseGame(),
    onAudioUnlock: () => {
      audio.resume();
      if (G.audio && G.audio.resume) G.audio.resume();
    },
  });
  touchCtrl.setHeroClass(activeHero);

  function triggerParryFeedback() {
    parryStreakCount++;
    parryBannerT = 0.92;
  }

  function startDragonbladeLunge(dir: any, rangeMeters: number) {
    if (!player.alive || !player.enabled || dashActiveT > 0) return;
    dragonLungeDir.copy(dir).normalize();
    if (player.onGround && dragonLungeDir.y < -0.18) {
      dragonLungeDir.y = -0.03;
      dragonLungeDir.normalize();
    }
    dragonLungeRange = Math.max(5.5, rangeMeters || buildStats.dragonbladeLungeRange || 7.6);
    dragonLungeStart.copy(player.pos).setY(player.pos.y + 0.9);
    dragonLungeHitIds.clear();
    dragonLungeActiveT = dragonLungeDur;
    dashGraceT = Math.max(dashGraceT, 0.22);
    fovKick = Math.min(10.5, fovKick + 3.0);
  }

  // --- Install GPU-Instanced Combat Feel VFX & Batching Telemetry Controller ---
  const combatVfx: CombatFeelVfxController =
    G.combatVfx ?? (G.combatVfx = createCombatFeelVfx(G));

  function applyHeavyHitstop(sec: number, fovPunchDeg = 0) {
    const clamped = clamp(sec, 0, 0.065);
    if (clamped > hitstopT) {
      hitstopT = clamped;
      combatVfx.notifyHitstop(clamped);
    }
    if (fovPunchDeg > 0) {
      fovKick = Math.min(10.5, fovKick + fovPunchDeg);
    }
  }

  // --- Install Genji Procedural First-Person Weapon, Custom GLSL Dragon & Sword-Ki VFX ---
  const genjiWeapon = createGenjiWeapon(G, {
    getStats: () => buildStats,
    isDeflecting: () => activeHero === 'genji' && cdState.deflectActiveT > 0,
    isDragonblade: () => activeHero === 'genji' && cdState.dragonActiveT > 0,
    audio,
    touch: touchCtrl,
    onDragonbladeLunge: (dir, rangeMeters) => startDragonbladeLunge(dir, rangeMeters),
    onParryFeedback: () => triggerParryFeedback(),
    raycastColossalBoss: (origin, dir, maxDist) => raycastColossalBoss(origin, dir, maxDist),
    damageColossalBoss: (amount, point, dir, orbIndex, source) =>
      damageColossalBoss(amount, point, dir, orbIndex, source),
    cleaveColossalBoss: (center, radius, amount, dir, source) =>
      cleaveColossalBoss(center, radius, amount, dir, source),
    onHeavyHit(sec: number, fovPunchDeg = 0) {
      applyHeavyHitstop(sec, fovPunchDeg);
    },
    onDamageDealt(amount, _enemy, _killed, weak, source) {
      if (amount > 0) {
        cdState.ultCharge = addUltimateDamageCharge(
          cdState.ultCharge,
          amount,
          buildStats.ultChargeMultiplier,
          cdState.dragonActiveT > 0
        );
      }
      if (
        amount > 0 &&
        buildStats.dragonbladeLifestealRatio > 0 &&
        (source === 'dragonblade' || source === 'dragon-wave')
      ) {
        player.heal(amount * buildStats.dragonbladeLifestealRatio);
      }
      if (weak && source === 'shuriken' && (upgradeStacks['shuriken_cadence'] || 0) > 0) {
        genjiWeapon.addAmmo(2);
      }
    },
  });

  function isPlayerInsideBioticField(): boolean {
    if (gunnerCd.bioticActiveT <= 0 || !player.alive) return false;
    const dx = player.pos.x - bioticCenter.x;
    const dz = player.pos.z - bioticCenter.z;
    const dy = Math.abs(player.pos.y - bioticCenter.y);
    return dx * dx + dz * dz <= gunnerStats.bioticRadius * gunnerStats.bioticRadius && dy <= 2.6;
  }

  // --- Install Tactical Gunner (`神机统帅 · 重型脉冲步枪`) Weapon & Skills ---
  const gunnerWeapon = createGunnerWeapon(G, {
    getStats: () => gunnerStats,
    isActive: () => activeHero === 'gunner',
    isSprinting: () => activeHero === 'gunner' && gunnerCd.sprintActive,
    onCancelSprint: () => {
      gunnerCd.sprintActive = false;
    },
    isVisorActive: () => activeHero === 'gunner' && gunnerCd.visorActiveT > 0,
    isInBioticField: () => isPlayerInsideBioticField(),
    tryConsumeHelixCooldown: () => {
      if (gunnerCd.helixCd > 0.01) return false;
      gunnerCd.helixCd = gunnerStats.helixCooldown;
      return true;
    },
    audio,
    touch: touchCtrl,
    raycastColossalBoss: (origin, dir, maxDist) => raycastColossalBoss(origin, dir, maxDist),
    damageColossalBoss: (amount, point, dir, orbIndex, source) =>
      damageColossalBoss(amount, point, dir, orbIndex, source),
    cleaveColossalBoss: (center, radius, amount, dir, source) =>
      cleaveColossalBoss(center, radius, amount, dir, source),
    getColossalBossVisorCandidate: (): VisorCandidate | null => {
      if (!colossusState || colossusState.hp <= 0 || !colossusRoot.visible) return null;
      for (let k = 0; k < 4; k++) {
        if (colossusState.orbsAlive[k]) {
          const wp = colossusOrbWorldPos[k];
          return {
            id: 999100 + k,
            aimPoint: { x: wp.x, y: wp.y, z: wp.z },
            isBoss: true,
            hpRatio: clamp01(colossusState.hp / Math.max(1, colossusState.maxHp)),
          };
        }
      }
      return {
        id: 999000,
        aimPoint: { x: colossusPos.x, y: colossusPos.y + 4.2, z: colossusPos.z },
        isBoss: true,
        hpRatio: clamp01(colossusState.hp / Math.max(1, colossusState.maxHp)),
      };
    },
    onHeavyHit(sec: number, fovPunchDeg = 0) {
      applyHeavyHitstop(sec, fovPunchDeg);
    },
    onDamageDealt(amount) {
      if (amount > 0) {
        gunnerCd.ultCharge = addUltimateDamageCharge(
          gunnerCd.ultCharge,
          amount * 0.78,
          gunnerStats.ultChargeMultiplier,
          gunnerCd.visorActiveT > 0
        );
      }
    },
  });

  // --- Install Shimada Hanzo (`岛田半藏 · 风林岚弓`) Weapon, Sonar Dome & Twin Spirit Dragons ---
  const hanzoWeapon = createHanzoWeapon(G, {
    getStats: () => hanzoStats,
    isActive: () => activeHero === 'hanzo',
    isStormActive: () => activeHero === 'hanzo' && hanzoCd.stormActiveT > 0 && hanzoCd.stormArrowsLeft > 0,
    getStormArrowsLeft: () => hanzoCd.stormArrowsLeft,
    consumeStormArrow: () => {
      hanzoCd.stormArrowsLeft = Math.max(0, hanzoCd.stormArrowsLeft - 1);
      if (hanzoCd.stormArrowsLeft <= 0) {
        hanzoCd.stormActiveT = 0;
      }
    },
    hasSmartRicochet: () => (upgradeStacks['deflect_homing'] || 0) > 0,
    hasStormSiphon: () => (upgradeStacks['deflect_siphon'] || 0) > 0,
    hasLightDrawMove: () => (upgradeStacks['vitality_overclock'] || 0) > 0,
    isSonicArmed: () => activeHero === 'hanzo' && hanzoCd.sonicArmed,
    consumeSonicArmed: () => {
      hanzoCd.sonicArmed = false;
      hanzoCd.sonicCd = hanzoStats.sonicCooldown;
    },
    onSonicFieldDeployed: (duration) => {
      hanzoCd.sonicActiveT = duration;
    },
    audio,
    touch: touchCtrl,
    raycastColossalBoss: (origin, dir, maxDist) => raycastColossalBoss(origin, dir, maxDist),
    damageColossalBoss: (amount, point, dir, orbIndex, source) =>
      damageColossalBoss(amount, point, dir, orbIndex, source),
    cleaveColossalBoss: (center, radius, amount, dir, source) =>
      cleaveColossalBoss(center, radius, amount, dir, source),
    onHeavyHit(sec: number, fovPunchDeg = 0) {
      applyHeavyHitstop(sec, fovPunchDeg);
    },
    onDamageDealt(amount, _enemy, _killed, _weak, source) {
      if (amount > 0 && source !== 'dragonstrike') {
        hanzoCd.ultCharge = addUltimateDamageCharge(
          hanzoCd.ultCharge,
          amount * 0.86,
          hanzoStats.ultChargeMultiplier,
          hanzoCd.dragonActiveT > 0
        );
      }
    },
  });

  G.weapon =
    activeHero === 'gunner'
      ? gunnerWeapon
      : activeHero === 'hanzo'
        ? hanzoWeapon
        : genjiWeapon;

  // Global Elimination Listener -> Resets Genji Swift Strike, refunds Gunner Helix CD, or refunds Hanzo Sonic/Storm/Lunge CD!
  const handleEnemyEliminated = (enemy: any) => {
    const isBoss = !!(enemy && enemy.__variant === 'boss');
    const isEliteMech = !!(
      enemy &&
      (enemy.__variant === 'spider_mech' ||
        enemy.__variant === 'mortar_crab' ||
        enemy.__variant === 'shield_guard')
    );
    if (activeHero === 'gunner') {
      gunnerCd.helixCd = isBoss
        ? 0
        : Math.max(0, gunnerCd.helixCd - (isEliteMech ? 2.6 : 1.8));
      if (gunnerCd.visorActiveT > 0) {
        if (gunnerCd.visorExtendsUsed < gunnerStats.maxVisorExtensions) {
          gunnerCd.visorExtendsUsed++;
          gunnerCd.visorActiveT = Math.min(
            gunnerCd.visorMaxT * 1.4,
            gunnerCd.visorActiveT + gunnerStats.visorExtendOnKill
          );
        }
      } else {
        gunnerCd.ultCharge = clamp(
          gunnerCd.ultCharge + (isBoss ? 22 : isEliteMech ? 9.5 : 7.5) * gunnerStats.ultChargeMultiplier,
          0,
          100
        );
      }
      swiftResetFlashT = 0.45;
      return;
    }

    if (activeHero === 'hanzo') {
      const updatedH = applyHanzoEliminationReset(hanzoCd, hanzoStats, isBoss || isEliteMech);
      hanzoCd.lungeCd = updatedH.lungeCd;
      hanzoCd.sonicCd = updatedH.sonicCd;
      hanzoCd.stormCd = updatedH.stormCd;
      hanzoCd.ultCharge = updatedH.ultCharge;
      if ((upgradeStacks['dragon_feast'] || 0) > 0) {
        const bonusCd = 1.8 * (upgradeStacks['dragon_feast'] || 1);
        hanzoCd.stormCd = Math.max(0, hanzoCd.stormCd - bonusCd);
        hanzoCd.sonicCd = Math.max(0, hanzoCd.sonicCd - bonusCd);
      }
      swiftResetFlashT = 0.52;
      return;
    }

    const wasOnCd = cdState.swiftCd > 0.05;
    const updated = applyGenjiEliminationReset(cdState, buildStats, isBoss);
    cdState.swiftCd = updated.swiftCd;
    cdState.ultCharge = updated.ultCharge;
    cdState.dragonActiveT = updated.dragonActiveT;
    cdState.dragonExtendsUsed = updated.dragonExtendsUsed;
    swiftResetFlashT = 0.72;
    if (wasOnCd) {
      audio.swiftReset();
    }
  };

  // --- Wrap `player` for Dual-Hero Mobility, Air-Wall Containment, Lunge & Deflect Guard ---
  const player = G.player;
  const origPlayerDamage = player.damage.bind(player);
  const origPlayerUpdate = player.update.bind(player);
  const origPlayerReset = player.reset.bind(player);

  // Tune base shinobi speed: fast, responsive aerial control, brisk natural recovery
  if (player.tuning) {
    player.tuning.walk = 6.3;
    player.tuning.sprint = 7.7;
    player.tuning.accelAir = 22;
    player.tuning.regenDelay = 4.2;
    player.tuning.regenRate = 22;
  }

  const _parryWorldPt = new THREE.Vector3();

  player.damage = (amount: number, fromPos: any) => {
    if (
      !player.alive ||
      player.invulnerable ||
      dashActiveT > 0 ||
      dragonLungeActiveT > 0 ||
      dashGraceT > 0
    ) {
      return;
    }

    // Deflect (`E · 心眼`) parries all frontal attacks & melee lunges with crisp feedback + counter-slash!
    if (activeHero === 'genji' && cdState.deflectActiveT > 0 && fromPos) {
      const dx = fromPos.x - player.pos.x;
      const dz = fromPos.z - player.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const fwdDot = (dx / dist) * player.forward.x + (dz / dist) * player.forward.z;
      if (fwdDot > -0.18 || dist < 2.6) {
        _parryWorldPt.copy(player.eye).addScaledVector(player.forward, 1.35);
        audio.deflectParry();
        genjiWeapon.onDeflectParry(_parryWorldPt);
        genjiWeapon.spawnParryBurst(_parryWorldPt, true);
        hitstopT = Math.max(hitstopT, 0.036);
        fovKick = Math.min(10.5, fovKick + 2.4);
        player.addShake(0.16);
        if (buildStats.deflectHealPerBolt > 0) {
          player.heal(buildStats.deflectHealPerBolt);
        }
        if (dist < 3.8 && G.enemies && G.enemies.list) {
          for (const en of G.enemies.list) {
            if (en.alive && en.pos.distanceTo(fromPos) < 1.8) {
              const dmg = 62 * buildStats.deflectMultiplier;
              const killed = en.damage(dmg, en.pos, player.forward, 'dragonblade') === true;
              G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
              cdState.ultCharge = addUltimateDamageCharge(
                cdState.ultCharge,
                dmg,
                buildStats.ultChargeMultiplier,
                cdState.dragonActiveT > 0
              );
            }
          }
        }
        return;
      }
    }

    // Nullify fall damage (`fromPos === null` when `player.pos.y > seaY`)
    if (fromPos === null && player.pos.y > -1.2) return;
    let finalDmg = amount;
    if (activeHero === 'gunner' && (gunnerCd.sprintActive || isPlayerInsideBioticField())) {
      finalDmg *= 0.75;
    }
    origPlayerDamage(finalDmg, fromPos);
  };

  player.reset = (spawn?: any) => {
    origPlayerReset(spawn);
    player.maxHealth =
      activeHero === 'gunner'
        ? gunnerStats.maxHealth
        : activeHero === 'hanzo'
          ? hanzoStats.maxHealth
          : buildStats.maxHealth;
    player.health = player.maxHealth;
    agilityState.airJumpsLeft =
      activeHero === 'gunner'
        ? gunnerStats.maxAirJumps
        : activeHero === 'hanzo'
          ? 0
          : buildStats.maxAirJumps;
    agilityState.wallClimbTimeLeft =
      activeHero === 'hanzo' ? hanzoStats.wallClimbDuration : buildStats.wallClimbDuration;
    agilityState.isWallClimbing = false;
    hanzoLungeChargesLeft = hanzoStats.maxAirJumps;
    dashActiveT = 0;
    dragonLungeActiveT = 0;
    dashGraceT = 0;
    gunnerCd.sprintActive = false;
    hitstopT = 0;
    fovKick = 0;
  };

  const _probeOrigin = new THREE.Vector3();
  const _probeOriginHigh = new THREE.Vector3();
  const _horizFwd = new THREE.Vector3();
  const _horizRight = new THREE.Vector3();
  const _lungeVec = new THREE.Vector3();
  const _segA = new THREE.Vector3();
  const _segB = new THREE.Vector3();
  const _aheadProbe = new THREE.Vector3();
  const _endRibbon = new THREE.Vector3();
  const _enemyCenter = new THREE.Vector3();

  function checkFacingClimbableWall(): { wall: boolean; ledgeClear: boolean } {
    const yaw = player.yaw;
    _horizFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    _probeOrigin.set(player.pos.x, player.pos.y + 0.55, player.pos.z);
    _probeOriginHigh.set(player.pos.x, player.pos.y + 1.65, player.pos.z);

    const lowHit = G.physics.raycast(_probeOrigin, _horizFwd, 0.92);
    if (!lowHit || Math.abs(lowHit.normal.y) > 0.36) {
      return { wall: false, ledgeClear: false };
    }
    const highHit = G.physics.raycast(_probeOriginHigh, _horizFwd, 1.02);
    return { wall: true, ledgeClear: !highHit };
  }

  function enforcePlayerAirWall() {
    const clamped = clampActorToAirWall({
      pos: player.pos,
      vel: player.vel,
      isFlying: false,
    });
    if (clamped.clampedX || clamped.clampedY || clamped.clampedZ) {
      player.pos.set(clamped.pos.x, clamped.pos.y, clamped.pos.z);
      player.vel.set(clamped.vel.x, clamped.vel.y, clamped.vel.z);
    }
  }

  const _touchAimPool: TouchAimCandidate[] = [];
  const _touchAimSlice: TouchAimCandidate[] = [];

  player.update = (dt: number) => {
    // Adjust dynamic move speed for active hero class
    if (player.tuning) {
      if (activeHero === 'gunner') {
        const sprintMult = gunnerCd.sprintActive ? gunnerStats.sprintSpeedMultiplier : 1.0;
        const visorMult = gunnerCd.visorActiveT > 0 ? 1.15 : 1.0;
        const spd = 6.0 * gunnerStats.moveSpeedMultiplier * visorMult;
        player.tuning.walk = spd * sprintMult;
        player.tuning.sprint = spd * Math.max(1.22, sprintMult);
        player.tuning.accelAir = 20;
      } else if (activeHero === 'hanzo') {
        const stormMult = hanzoCd.stormActiveT > 0 ? 1.10 : 1.0;
        const spd = 6.1 * hanzoStats.moveSpeedMultiplier * stormMult;
        player.tuning.walk = spd;
        player.tuning.sprint = spd * 1.18;
        player.tuning.accelAir = 22;
      } else {
        const dragonMult = cdState.dragonActiveT > 0 ? 1.32 : 1.0;
        const deflectMult = cdState.deflectActiveT > 0 ? 1.12 : 1.0;
        const spd = 6.3 * buildStats.moveSpeedMultiplier * dragonMult * deflectMult;
        player.tuning.walk = spd;
        player.tuning.sprint = spd * 1.22;
        player.tuning.accelAir = 22;
      }
    }

    const wasOnGround = player.onGround;

    // 1. Active Dragonblade LMB Forward Lunge (`Q · 拔刀突进斩`): fast 7.6m–10.8m sword-dash cleave!
    if (activeHero === 'genji' && dragonLungeActiveT > 0 && player.alive && player.enabled) {
      const stepT = Math.min(dt, dragonLungeActiveT);
      dragonLungeActiveT -= stepT;
      const lungeSpeed = dragonLungeRange / dragonLungeDur;

      _segA.copy(player.pos).setY(player.pos.y + 0.95);
      _aheadProbe.copy(_segA).addScaledVector(dragonLungeDir, Math.min(2.4, lungeSpeed * stepT + 1.0));
      if (G.level && typeof G.level.damageInRadius === 'function') {
        const smashed = G.level.damageInRadius(_aheadProbe, 2.2, buildStats.dragonbladeSlashDamage, dragonLungeDir);
        if (smashed > 0) audio.structureBreak(true);
      }

      player.vel.copy(dragonLungeDir).multiplyScalar(lungeSpeed);
      const res = G.physics.moveCapsule(player.pos, player.vel, stepT, 0.36, 1.65, false) || {};
      enforcePlayerAirWall();
      player.onGround = !!res.onGround;
      _segB.copy(player.pos).setY(player.pos.y + 0.95);

      if (G.enemies && G.enemies.list) {
        for (const en of G.enemies.list) {
          if (!en.alive || dragonLungeHitIds.has(en.id)) continue;
          const ex = en.pos.x;
          const ey = en.pos.y + 0.9;
          const ez = en.pos.z;
          const abx = _segB.x - _segA.x;
          const aby = _segB.y - _segA.y;
          const abz = _segB.z - _segA.z;
          const abLenSq = abx * abx + aby * aby + abz * abz || 1e-5;
          const tProj = clamp01(((ex - _segA.x) * abx + (ey - _segA.y) * aby + (ez - _segA.z) * abz) / abLenSq);
          const dist = Math.hypot(ex - (_segA.x + abx * tProj), ey - (_segA.y + aby * tProj), ez - (_segA.z + abz * tProj));
          if (dist <= 2.6 + (en.__variant === 'boss' ? 0.8 : 0)) {
            dragonLungeHitIds.add(en.id);
            const dmg = buildStats.dragonbladeSlashDamage;
            _enemyCenter.set(ex, ey, ez);
            const killed = en.damage(dmg, _enemyCenter, dragonLungeDir, 'dragonblade') === true;
            if (G.combat && G.combat.stats) {
              G.combat.stats.shots++;
              G.combat.stats.hits++;
            }
            G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
            audio.bladeCleaveImpact(killed);
            hitstopT = Math.max(hitstopT, killed ? 0.048 : 0.028);
            if (buildStats.dragonbladeLifestealRatio > 0) {
              player.heal(dmg * buildStats.dragonbladeLifestealRatio);
            }
          }
        }
      }

      if (colossusState && colossusState.hp > 0 && !dragonLungeHitIds.has(999002)) {
        const cRes = cleaveColossalBoss(_segB, 3.8, buildStats.dragonbladeSlashDamage, dragonLungeDir, 'dragonblade');
        if (cRes.hit) {
          dragonLungeHitIds.add(999002);
          audio.bladeCleaveImpact(cRes.killed || cRes.orbShattered);
          hitstopT = Math.max(hitstopT, 0.042);
        }
      }

      if (dragonLungeActiveT <= 0) {
        player.vel.multiplyScalar(0.22);
        _endRibbon.copy(player.pos).setY(player.pos.y + 0.9);
        genjiWeapon.spawnDashRibbon(dragonLungeStart, _endRibbon, false);
      }
      origPlayerUpdate(0.0001);
      enforcePlayerAirWall();
      return;
    }

    // 2. Active Swift Strike (`Shift · 影`) overrides normal velocity with ultra-fast 3D dash + building breach!
    if (activeHero === 'genji' && dashActiveT > 0 && player.alive && player.enabled) {
      const stepT = Math.min(dt, dashActiveT);
      dashActiveT -= stepT;
      const dashDur = Math.max(0.08, buildStats.swiftStrikeDuration);
      const dashSpeed = buildStats.swiftStrikeRange / dashDur;

      _segA.copy(player.pos).setY(player.pos.y + 0.95);
      _aheadProbe.copy(_segA).addScaledVector(dashDir, Math.min(2.6, dashSpeed * stepT + 1.1));
      if (G.level && typeof G.level.damageInRadius === 'function') {
        const smashed = G.level.damageInRadius(_aheadProbe, 2.35, buildStats.swiftStrikeDamage + 45, dashDir);
        if (smashed > 0) {
          audio.structureBreak(true);
          player.addShake(0.22);
          fovKick = Math.min(10.5, fovKick + 1.8);
        }
      }

      player.vel.copy(dashDir).multiplyScalar(dashSpeed);
      const res = G.physics.moveCapsule(player.pos, player.vel, stepT, 0.36, 1.65, false) || {};
      enforcePlayerAirWall();
      player.onGround = !!res.onGround;
      _segB.copy(player.pos).setY(player.pos.y + 0.95);

      if (G.enemies && G.enemies.list) {
        for (const en of G.enemies.list) {
          if (!en.alive || dashHitIds.has(en.id)) continue;
          const ex = en.pos.x;
          const ey = en.pos.y + 0.9;
          const ez = en.pos.z;
          const abx = _segB.x - _segA.x;
          const aby = _segB.y - _segA.y;
          const abz = _segB.z - _segA.z;
          const abLenSq = abx * abx + aby * aby + abz * abz || 1e-5;
          const tProj = clamp01(((ex - _segA.x) * abx + (ey - _segA.y) * aby + (ez - _segA.z) * abz) / abLenSq);
          const cx = _segA.x + abx * tProj;
          const cy = _segA.y + aby * tProj;
          const cz = _segA.z + abz * tProj;
          const dist = Math.hypot(ex - cx, ey - cy, ez - cz);
          if (dist <= 2.25 + (en.__variant === 'boss' ? 0.75 : 0)) {
            dashHitIds.add(en.id);
            const dmg = buildStats.swiftStrikeDamage;
            _enemyCenter.set(ex, ey, ez);
            const killed = en.damage(dmg, _enemyCenter, dashDir, 'dragonblade') === true;
            if (G.combat && G.combat.stats) {
              G.combat.stats.shots++;
              G.combat.stats.hits++;
            }
            G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
            audio.bladeCleaveImpact(killed);
            hitstopT = Math.max(hitstopT, killed ? 0.042 : 0.025);
            cdState.ultCharge = addUltimateDamageCharge(
              cdState.ultCharge,
              dmg,
              buildStats.ultChargeMultiplier,
              cdState.dragonActiveT > 0
            );
            if (buildStats.swiftStrikeShieldOnHit > 0) {
              player.heal(buildStats.swiftStrikeShieldOnHit);
            }
          }
        }
      }

      if (colossusState && colossusState.hp > 0 && !dashHitIds.has(999001)) {
        const cRes = cleaveColossalBoss(_segB, 3.6, buildStats.swiftStrikeDamage * 1.25, dashDir, 'swift');
        if (cRes.hit) {
          dashHitIds.add(999001);
          audio.bladeCleaveImpact(cRes.killed || cRes.orbShattered);
          hitstopT = Math.max(hitstopT, cRes.orbShattered ? 0.048 : 0.028);
          if (buildStats.swiftStrikeShieldOnHit > 0) {
            player.heal(buildStats.swiftStrikeShieldOnHit);
          }
        }
      }

      if (dashActiveT <= 0) {
        player.vel.multiplyScalar(0.2);
        _endRibbon.copy(player.pos).setY(player.pos.y + 0.9);
        genjiWeapon.spawnDashRibbon(dashStartPos, _endRibbon, buildStats.swiftStrikeGhostFireCount > 0);
        if (buildStats.swiftStrikeGhostFireCount > 0) {
          genjiWeapon.spawnHomingKunai(_endRibbon, buildStats.swiftStrikeGhostFireCount, 42);
        }
      }
      origPlayerUpdate(0.0001);
      enforcePlayerAirWall();
      return;
    }

    // Inject mobile virtual thumbstick & fire state into G.input before base movement step
    touchCtrl.applyToInput();

    // Gunner mobile joystick sprint synergy: forward stick push or active `疾` toggle drives full sprint smoothly
    if (activeHero === 'gunner' && touchCtrl.active) {
      if (touchCtrl.isSprinting() && !G.input.fire) {
        gunnerCd.sprintActive = true;
      }
      if (gunnerCd.sprintActive && Math.hypot(G.input.move.x, G.input.move.y) > 0.22 && !G.input.fire) {
        G.input.sprint = true;
      }
    }

    // Zero-GC Mobile Aim Assist (`准星摩擦减速 + 轻度吸附辅助`)
    if (touchCtrl.active && touchCtrl.aimAssistEnabled && player.alive && player.enabled) {
      let candCount = 0;
      const enemyList = G.enemies && G.enemies.list;
      if (Array.isArray(enemyList)) {
        for (let i = 0; i < enemyList.length && candCount < 18; i++) {
          const en = enemyList[i];
          if (!en || !en.alive || !en.pos) continue;
          const aimY = en.headPos && Number.isFinite(en.headPos.y) ? en.headPos.y - 0.12 : en.pos.y + 1.15;
          const aimX = en.headPos && Number.isFinite(en.headPos.x) ? en.headPos.x : en.pos.x;
          const aimZ = en.headPos && Number.isFinite(en.headPos.z) ? en.headPos.z : en.pos.z;
          const dxE = aimX - player.eye.x;
          const dyE = aimY - player.eye.y;
          const dzE = aimZ - player.eye.z;
          if (dxE * dxE + dyE * dyE + dzE * dzE > 72 * 72) continue;
          if (G.physics && G.physics.lineOfSight) {
            _aheadProbe.set(aimX, aimY, aimZ);
            if (!G.physics.lineOfSight(player.eye, _aheadProbe)) continue;
          }
          let slot = _touchAimPool[candCount];
          if (!slot) {
            slot = { id: 0, aimPoint: { x: 0, y: 0, z: 0 }, isPriority: false };
            _touchAimPool[candCount] = slot;
          }
          slot.id = i + 1;
          slot.aimPoint.x = aimX;
          slot.aimPoint.y = aimY;
          slot.aimPoint.z = aimZ;
          slot.isPriority = en.genjiVariant === 'boss' || en.genjiVariant === 'sniper';
          candCount++;
        }
      }
      if (colossusState && colossusState.hp > 0 && colossusRoot.visible) {
        for (let k = 0; k < 4 && candCount < 22; k++) {
          if (!colossusState.orbsAlive[k]) continue;
          const wp = colossusOrbWorldPos[k];
          let slot = _touchAimPool[candCount];
          if (!slot) {
            slot = { id: 0, aimPoint: { x: 0, y: 0, z: 0 }, isPriority: true };
            _touchAimPool[candCount] = slot;
          }
          slot.id = 9000 + k;
          slot.aimPoint.x = wp.x;
          slot.aimPoint.y = wp.y;
          slot.aimPoint.z = wp.z;
          slot.isPriority = true;
          candCount++;
        }
      }
      _touchAimSlice.length = 0;
      for (let i = 0; i < candCount; i++) {
        _touchAimSlice.push(_touchAimPool[i]);
      }
      if (_touchAimSlice.length > 0) {
        const isEngagingFire =
          !!G.input.fire ||
          touchCtrl.isFireHeld() ||
          (activeHero === 'hanzo' && hanzoCd.drawRatio > 0.02);
        const assist = computeTouchAimAssist({
          enabled: true,
          eyePos: player.eye,
          yaw: player.yaw,
          pitch: player.pitch,
          rawLookDx: G.input.look.dx,
          rawLookDy: G.input.look.dy,
          moveMagnitude: Math.hypot(G.input.move.x, G.input.move.y),
          isFiringOrDrawing: isEngagingFire,
          dt,
          candidates: _touchAimSlice,
        });
        G.input.look.dx *= assist.frictionScale;
        G.input.look.dy *= assist.frictionScale;
        if (assist.yawPullRad !== 0 || assist.pitchPullRad !== 0) {
          player.yaw += assist.yawPullRad;
          player.pitch = clamp(player.pitch + assist.pitchPullRad, -1.5, 1.5);
        }
      }
    }

    const touchJumpJust = touchCtrl.consumeJumpPressed();
    const jumpPressed = G.input.pressed('jump') || consumeKey(['Space']) || touchJumpJust;
    const jumpHeld = G.input.down('jump') || isKeyHeld(['Space']) || touchCtrl.isJumpHeld();

    origPlayerUpdate(dt);
    if (G.camera && G.camera.rotation) {
      G.camera.rotation.z += combatVfx.getCameraRollOffset();
    }
    enforcePlayerAirWall();

    if (!player.alive || !player.enabled) return;

    // Mobile `灵/跃` tap while grounded -> crisp ground jump
    if (touchJumpJust && wasOnGround && player.onGround) {
      player.vel.y = 7.2;
      player.onGround = false;
      player.crouching = false;
      G.events.emit('player:jump', { pos: player.pos });
    }

    if (activeHero === 'gunner') {
      agilityState.isWallClimbing = false;
      if (player.onGround) {
        agilityState.airJumpsLeft = gunnerStats.maxAirJumps;
      } else if (!wasOnGround && jumpPressed && agilityState.airJumpsLeft > 0) {
        agilityState.airJumpsLeft--;
        player.vel.y = Math.max(player.vel.y, 7.6);
        player.crouching = false;
        audio.doubleJump();
        fovKick = Math.min(10.5, fovKick + 1.1);
      }
      // Auto-stop Tactical Sprint ONLY if player stops both keyboard WASD and mobile joystick input
      const moveMag = Math.hypot(player.vel.x, player.vel.z);
      const stickInputMag = Math.hypot(G.input.move.x, G.input.move.y);
      if (
        gunnerCd.sprintActive &&
        moveMag < 0.8 &&
        stickInputMag < 0.16 &&
        !isKeyHeld(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp'])
      ) {
        gunnerCd.sprintActive = false;
      }
      return;
    }

    // Shimada Hanzo (`岛田半藏`): Wall Climb (`壁攀`) + Mid-Air Horizontal Lunge (`跃步`)!
    if (activeHero === 'hanzo') {
      if (player.onGround) {
        hanzoLungeChargesLeft = hanzoStats.maxAirJumps;
      }
      const wallCheckH = !player.onGround ? checkFacingClimbableWall() : { wall: false, ledgeClear: false };
      const wasClimbingH = agilityState.isWallClimbing;

      const agResH = stepCyberAgility({
        state: agilityState,
        stats: {
          maxAirJumps: 0,
          wallClimbDuration: hanzoStats.wallClimbDuration,
          wallClimbSpeed: hanzoStats.wallClimbSpeed,
        } as any,
        onGround: player.onGround,
        jumpJustPressed: false,
        jumpHeld: !player.onGround && jumpHeld && player.vel.y < hanzoStats.wallClimbSpeed + 0.8,
        facingVerticalWall: wallCheckH.wall,
        dt,
      });

      agilityState.wallClimbTimeLeft = agResH.next.wallClimbTimeLeft;
      agilityState.isWallClimbing = agResH.next.isWallClimbing;

      if (agResH.next.isWallClimbing && agResH.climbVelY !== null) {
        player.vel.y = agResH.climbVelY;
        const yaw = player.yaw;
        player.vel.x = -Math.sin(yaw) * 1.85;
        player.vel.z = -Math.cos(yaw) * 1.85;
        climbStepSoundT -= dt;
        if (climbStepSoundT <= 0) {
          climbStepSoundT = 0.14;
          audio.wallClimbStep();
        }
        if (wallCheckH.ledgeClear) {
          player.vel.y = 5.2;
          player.vel.x = -Math.sin(yaw) * 4.4;
          player.vel.z = -Math.cos(yaw) * 4.4;
          agilityState.isWallClimbing = false;
        }
      } else if (wasClimbingH && !player.onGround) {
        const yaw = player.yaw;
        player.vel.y = Math.max(player.vel.y, 4.1);
        player.vel.x = -Math.sin(yaw) * 3.8;
        player.vel.z = -Math.cos(yaw) * 3.8;
      } else if (
        !wasOnGround &&
        jumpPressed &&
        !wallCheckH.wall &&
        hanzoLungeChargesLeft > 0 &&
        (hanzoCd.lungeCd <= 0 || hanzoLungeChargesLeft > 1)
      ) {
        // Horizontal Lunge (`跃步`) in WASD movement direction or facing direction
        hanzoLungeChargesLeft--;
        if (hanzoLungeChargesLeft <= 0) {
          hanzoCd.lungeCd = hanzoStats.lungeCooldown;
        }
        const yaw = player.yaw;
        _horizFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        _horizRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const keyF = (isKeyHeld(['KeyW', 'ArrowUp']) ? 1 : 0) - (isKeyHeld(['KeyS', 'ArrowDown']) ? 1 : 0);
        const keyR = (isKeyHeld(['KeyD', 'ArrowRight']) ? 1 : 0) - (isKeyHeld(['KeyA', 'ArrowLeft']) ? 1 : 0);
        const stickF = G.input ? G.input.move.y : 0;
        const stickR = G.input ? G.input.move.x : 0;
        const inF = Math.abs(stickF) > Math.abs(keyF) ? stickF : keyF;
        const inR = Math.abs(stickR) > Math.abs(keyR) ? stickR : keyR;
        _lungeVec.set(0, 0, 0).addScaledVector(_horizFwd, inF).addScaledVector(_horizRight, inR);
        if (_lungeVec.lengthSq() < 0.05) {
          _lungeVec.copy(_horizFwd);
        } else {
          _lungeVec.normalize();
        }
        player.vel.x = _lungeVec.x * hanzoStats.lungeSpeed;
        player.vel.z = _lungeVec.z * hanzoStats.lungeSpeed;
        player.vel.y = Math.max(player.vel.y, 4.4);
        if (hanzoStats.lungeShieldHeal > 0) {
          player.heal(hanzoStats.lungeShieldHeal);
        }
        audio.hanzoLunge();
        player.addShake(0.11);
        fovKick = Math.min(10.5, fovKick + 2.4);
        if (G.render && G.render.lightPool) {
          G.render.lightPool.flash(player.pos, 0x4ee8ff, 22, 4.5, 0.09);
        }
      }
      enforcePlayerAirWall();
      return;
    }

    const wallCheck = !player.onGround ? checkFacingClimbableWall() : { wall: false, ledgeClear: false };
    const wasClimbing = agilityState.isWallClimbing;

    const agRes = stepCyberAgility({
      state: agilityState,
      stats: buildStats,
      onGround: player.onGround,
      jumpJustPressed: !wasOnGround && jumpPressed,
      jumpHeld: !player.onGround && jumpHeld && player.vel.y < buildStats.wallClimbSpeed + 0.8,
      facingVerticalWall: wallCheck.wall,
      dt,
    });

    agilityState.airJumpsLeft = agRes.next.airJumpsLeft;
    agilityState.wallClimbTimeLeft = agRes.next.wallClimbTimeLeft;
    agilityState.isWallClimbing = agRes.next.isWallClimbing;

    if (agRes.next.isWallClimbing && agRes.climbVelY !== null) {
      player.vel.y = agRes.climbVelY;
      const yaw = player.yaw;
      player.vel.x = -Math.sin(yaw) * 1.85;
      player.vel.z = -Math.cos(yaw) * 1.85;
      climbStepSoundT -= dt;
      if (climbStepSoundT <= 0) {
        climbStepSoundT = 0.14;
        audio.wallClimbStep();
      }
      if (wallCheck.ledgeClear) {
        player.vel.y = 5.2;
        player.vel.x = -Math.sin(yaw) * 4.4;
        player.vel.z = -Math.cos(yaw) * 4.4;
        agilityState.isWallClimbing = false;
      }
    } else if (wasClimbing && !player.onGround) {
      const yaw = player.yaw;
      player.vel.y = Math.max(player.vel.y, 4.1);
      player.vel.x = -Math.sin(yaw) * 3.8;
      player.vel.z = -Math.cos(yaw) * 3.8;
    } else if (agRes.didAirJump) {
      player.vel.y = 8.3;
      audio.doubleJump();
      player.addShake(0.09);
      fovKick = Math.min(10.5, fovKick + 1.6);
      if (G.render && G.render.lightPool) {
        G.render.lightPool.flash(player.pos, 0x6dffb8, 22, 4.5, 0.08);
      }
    }
    enforcePlayerAirWall();
  };

  // --- Trigger Genji & Gunner Hero Abilities ---
  function triggerDeflectIaidoFinisher() {
    if (activeHero === 'genji' && buildStats.deflectShockwaveDamage > 0 && player.alive) {
      genjiWeapon.spawnShockwaveSlash(buildStats.deflectShockwaveDamage);
      audio.dragonSlash(true);
      fovKick = Math.min(10.5, fovKick + 2.5);
    }
  }

  function tryCastSwiftStrike() {
    if (
      activeHero !== 'genji' ||
      cdState.swiftCd > 0 ||
      dashActiveT > 0 ||
      dragonLungeActiveT > 0 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    cdState.swiftCd = buildStats.swiftStrikeCooldown;
    if (cdState.deflectActiveT > 0) {
      cdState.deflectActiveT = 0;
      triggerDeflectIaidoFinisher();
    }

    dashDir.copy(player.forward).normalize();
    if (player.onGround && dashDir.y < -0.15) {
      dashDir.y = -0.04;
      dashDir.normalize();
    }
    dashStartPos.copy(player.pos).setY(player.pos.y + 0.9);
    dashHitIds.clear();
    dashActiveT = buildStats.swiftStrikeDuration;
    dashGraceT = 0.30;

    audio.swiftStrike();
    player.addShake(0.24);
    fovKick = Math.min(10.5, fovKick + 3.2);
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(dashStartPos, 0x3cff88, 55, 9.5, 0.14);
    }
  }

  const _bioticHitDir = new THREE.Vector3();

  function tryCastDeflect() {
    if (
      activeHero !== 'genji' ||
      cdState.deflectCd > 0 ||
      cdState.deflectActiveT > 0 ||
      dashActiveT > 0 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    parryStreakCount = 0;
    cdState.deflectActiveT = buildStats.deflectDuration;
    cdState.deflectCd = buildStats.deflectCooldown + buildStats.deflectDuration;

    // Immediate Single-Katana Iaijutsu Draw-Slash (`拔刀斩击`) across screen + frontal cleave!
    genjiWeapon.triggerDeflectDrawSlash();
    audio.deflectStart();
    audio.meleeSlash();
    player.addShake(0.11);
    fovKick = Math.min(10.5, fovKick + 1.8);

    const drawCleaveDmg = Math.round(78 * Math.max(1, buildStats.deflectMultiplier * 0.5));
    _aheadProbe.copy(player.eye).addScaledVector(player.forward, 2.0);
    if (G.level && typeof G.level.damageInRadius === 'function') {
      G.level.damageInRadius(_aheadProbe, 2.3, drawCleaveDmg, player.forward);
    }
    cleaveColossalBoss(player.eye, 4.4, drawCleaveDmg, player.forward, 'deflect-draw');
    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive) continue;
        _enemyCenter.set(en.pos.x, en.pos.y + 0.9, en.pos.z);
        _bioticHitDir.copy(_enemyCenter).sub(player.eye);
        const dist = _bioticHitDir.length();
        if (dist <= 3.9 && (dist < 1.4 || _bioticHitDir.multiplyScalar(1 / dist).dot(player.forward) > 0.30)) {
          const killed = en.damage(drawCleaveDmg, _enemyCenter, player.forward, 'dragonblade') === true;
          audio.bladeCleaveImpact(killed);
          hitstopT = Math.max(hitstopT, killed ? 0.040 : 0.022);
          G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
          cdState.ultCharge = addUltimateDamageCharge(
            cdState.ultCharge,
            drawCleaveDmg,
            buildStats.ultChargeMultiplier,
            cdState.dragonActiveT > 0
          );
        }
      }
    }
  }

  function tryCastDragonblade() {
    if (
      activeHero !== 'genji' ||
      cdState.ultCharge < 100 ||
      cdState.dragonActiveT > 0 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    cdState.ultCharge = 0;
    cdState.dragonMaxT = buildStats.dragonbladeDuration;
    cdState.dragonActiveT = buildStats.dragonbladeDuration;
    cdState.dragonExtendsUsed = 0;
    cdState.swiftCd = 0;
    swiftResetFlashT = 0.9;
    if (cdState.deflectActiveT > 0) {
      cdState.deflectActiveT = 0;
      triggerDeflectIaidoFinisher();
    }

    player.heal(65);
    player.addShake(0.42);
    fovKick = Math.min(10.5, fovKick + 4.8);
    hitstopT = Math.max(hitstopT, 0.045);
    genjiWeapon.onCastDragonblade();
    audio.dragonbladeCast();
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(player.eye, 0x45ff90, 95, 16, 0.38);
    }
    if (G.level && typeof G.level.damageInRadius === 'function') {
      G.level.damageInRadius(player.pos, 4.2, 55, player.forward);
    }
    G.hud.warn('龙神之剑 · 拔刀出鞘！', 2.4);
  }

  function toggleGunnerSprint() {
    if (activeHero !== 'gunner' || !player.alive || !player.enabled) return;
    gunnerCd.sprintActive = !gunnerCd.sprintActive;
    if (gunnerCd.sprintActive) {
      fovKick = Math.min(10.5, fovKick + 2.2);
    }
  }

  function tryCastBioticField() {
    if (
      activeHero !== 'gunner' ||
      gunnerCd.bioticCd > 0.05 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    gunnerCd.bioticActiveT = gunnerStats.bioticDuration;
    gunnerCd.bioticCd = gunnerStats.bioticCooldown;
    const gY = G.physics.groundHeight(player.pos.x, player.pos.z, player.pos.y + 0.6);
    bioticCenter.set(player.pos.x, Number.isFinite(gY) ? gY : player.pos.y, player.pos.z);
    bioticHealFrac = 0;
    gunnerWeapon.deployBioticField(bioticCenter, gunnerStats.bioticDuration, gunnerStats.bioticRadius);
    audio.bioticDeploy();
    player.heal(18);
    if (gunnerStats.bioticPulseShockwave > 0) {
      const shockR = gunnerStats.bioticRadius + 2.4;
      const shockDmg = gunnerStats.bioticPulseShockwave;
      const list: any[] = G.enemies.list || [];
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e || !e.alive) continue;
        const dx = e.pos.x - bioticCenter.x;
        const dz = e.pos.z - bioticCenter.z;
        const d = Math.hypot(dx, dz);
        if (d <= shockR && Math.abs(e.pos.y - bioticCenter.y) <= 3.6) {
          _bioticHitDir.set(dx || 1, 0.2, dz || 0).normalize();
          e.__bypassShieldOnce = true;
          e.damage(shockDmg, e.pos, _bioticHitDir, 'body');
        }
      }
      cleaveColossalBoss(bioticCenter, shockR + 1.5, shockDmg, player.forward, 'biotic-shock');
      if (G.level && typeof G.level.damageDestructiblesInSphere === 'function') {
        G.level.damageDestructiblesInSphere(bioticCenter, shockR, shockDmg);
      }
      fovKick = Math.min(10.5, fovKick + 2.2);
    }
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(bioticCenter, 0xffe066, 52, gunnerStats.bioticRadius * 2.2, 0.22);
    }
  }

  function tryCastTacticalVisor() {
    if (
      activeHero !== 'gunner' ||
      gunnerCd.ultCharge < 100 ||
      gunnerCd.visorActiveT > 0 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    gunnerCd.ultCharge = 0;
    gunnerCd.sprintActive = false;
    gunnerCd.visorExtendsUsed = 0;
    gunnerCd.visorMaxT = gunnerStats.visorDuration;
    gunnerCd.visorActiveT = gunnerStats.visorDuration;
    gunnerCd.helixCd = Math.min(gunnerCd.helixCd, 0.5);
    player.heal(55);
    fovKick = Math.min(10.5, fovKick + 3.8);
    gunnerWeapon.onCastVisor();
    audio.visorCast();
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(player.eye, 0xff5a40, 68, 12, 0.26);
    }
    G.hud.warn('战术目镜 · 我看到你们了！', 2.4);
  }

  // --- Shimada Hanzo (`岛田半藏`) Hero Abilities: Sonic Arrow (`Shift`), Storm Arrows (`E`), Dragonstrike (`Q`) ---
  function toggleSonicArrow() {
    if (activeHero !== 'hanzo' || !player.alive || !player.enabled) return;
    if (hanzoCd.sonicArmed) {
      hanzoCd.sonicArmed = false;
      return;
    }
    if (hanzoCd.sonicCd > 0.05) return;
    hanzoCd.sonicArmed = true;
    audio.bowDrawStart();
  }

  function activateStormArrows() {
    if (
      activeHero !== 'hanzo' ||
      hanzoCd.stormCd > 0.05 ||
      hanzoCd.stormActiveT > 0 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    hanzoCd.stormArrowsLeft = hanzoStats.stormArrowCount;
    hanzoCd.stormActiveT = hanzoStats.stormArrowDuration;
    hanzoCd.stormCd = hanzoStats.stormArrowCooldown;
    audio.stormArrowsCast();
    fovKick = Math.min(10.5, fovKick + 2.0);
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(player.eye, 0x38d8ff, 34, 7.5, 0.14);
    }
  }

  function tryCastDragonstrike() {
    if (
      activeHero !== 'hanzo' ||
      hanzoCd.ultCharge < 100 ||
      hanzoCd.dragonActiveT > 0 ||
      !player.alive ||
      !player.enabled
    ) {
      return;
    }
    hanzoCd.ultCharge = 0;
    hanzoCd.dragonActiveT = hanzoStats.dragonstrikeDuration;
    hanzoCd.lungeCd = 0;
    hanzoLungeChargesLeft = hanzoStats.maxAirJumps;
    player.heal(55);
    player.addShake(0.36);
    fovKick = Math.min(10.5, fovKick + 4.4);
    hitstopT = Math.max(hitstopT, 0.038);
    hanzoWeapon.onCastDragonstrike();
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(player.eye, 0x38d8ff, 88, 16, 0.34);
    }
    G.hud.warn('龙魂双生 · 龙啊，吞噬我的敌人吧！', 2.8);
  }

  // =========================================================================
  // BLAZING 2.6m JADE-GOLD REFLECTED SPEARS POOL (`E · 心眼闪反` 反弹烈枪)
  // =========================================================================
  const MAX_DEFLECT_SPEARS = 56;
  const spearOuterGeo = new THREE.ConeGeometry(0.032, 1.75, 6, 1);
  spearOuterGeo.rotateX(Math.PI / 2);
  spearOuterGeo.translate(0, 0, -0.85);
  const spearOuterMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x3cff8e),
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const spearCoreGeo = new THREE.ConeGeometry(0.016, 1.45, 5, 1);
  spearCoreGeo.rotateX(Math.PI / 2);
  spearCoreGeo.translate(0, 0, -0.72);
  const spearCoreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff4b8),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const deflectOuterInst = new THREE.InstancedMesh(spearOuterGeo, spearOuterMat, MAX_DEFLECT_SPEARS);
  deflectOuterInst.frustumCulled = false;
  deflectOuterInst.count = 0;
  deflectOuterInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  G.scene.add(deflectOuterInst);

  const deflectCoreInst = new THREE.InstancedMesh(spearCoreGeo, spearCoreMat, MAX_DEFLECT_SPEARS);
  deflectCoreInst.frustumCulled = false;
  deflectCoreInst.count = 0;
  deflectCoreInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  G.scene.add(deflectCoreInst);

  const deflectSpears: DeflectedSpear[] = [];
  for (let i = 0; i < MAX_DEFLECT_SPEARS; i++) {
    deflectSpears.push({
      active: false,
      originPos: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      speed: 112,
      damage: 110,
      life: 0,
      traveledDist: 0,
      homing: false,
    });
  }

  const ecsCombatInit = G.ecsCombat as EcsCombatBridge | undefined;
  if (ecsCombatInit) {
    ecsCombatInit.registerProjectilePool({
      name: 'deflect_spears',
      kind: PROJECTILE_KIND.DEFLECT_SPEAR,
      faction: 0,
      items: deflectSpears,
      isActive: (sp) => sp.active,
    });
  }

  combatVfx.registerBatch({
    name: 'genji_deflect_spears',
    meshes: [deflectOuterInst, deflectCoreInst],
    getActiveCount: () => deflectOuterInst.count,
    legacyMeshesPerItem: 2,
  });
  if (G.enemies && G.enemies.debug && G.enemies.debug.boltMesh) {
    combatVfx.registerBatch({
      name: 'enemy_bolts',
      meshes: [G.enemies.debug.boltMesh],
      getActiveCount: () => G.enemies.debug.boltMesh.count,
      legacyMeshesPerItem: 1,
    });
  }

  const _weakCand = new THREE.Vector3();
  const _weakToDir = new THREE.Vector3();
  const _weakOut = new THREE.Vector3();

  function findNearestEnemyWeakspot(fromPos: any): any | null {
    let hasBest = false;
    let bestScore = Infinity;

    // Prioritize Colossal Boss's glowing Raijin Taiko weakspot orbs when aligned!
    if (colossusState && colossusState.hp > 0) {
      for (let k = 0; k < 4; k++) {
        if (!colossusState.orbsAlive[k]) continue;
        const wp = colossusOrbWorldPos[k];
        const d = wp.distanceTo(fromPos);
        if (d > 105) continue;
        _weakToDir.copy(wp).sub(G.camera.position).normalize();
        const align = _weakToDir.dot(player.forward);
        if (align < 0.12) continue;
        const score = d * (1.25 - align) * 0.72;
        if (score < bestScore) {
          bestScore = score;
          _weakOut.copy(wp);
          hasBest = true;
        }
      }
      if (!hasBest) {
        _weakCand.set(colossusPos.x, colossusPos.y + 4.1, colossusPos.z);
        _weakToDir.copy(_weakCand).sub(G.camera.position).normalize();
        if (_weakToDir.dot(player.forward) > 0.2) {
          _weakOut.copy(_weakCand);
          bestScore = _weakCand.distanceTo(fromPos) * 0.9;
          hasBest = true;
        }
      }
    }

    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive) continue;
        if (en.headPos) {
          _weakCand.copy(en.headPos);
        } else {
          _weakCand.set(
            en.pos.x,
            en.pos.y + (en.type === 'hound' ? 0.68 : en.type === 'trooper' ? 1.48 : 0.28),
            en.pos.z
          );
        }
        const d = _weakCand.distanceTo(fromPos);
        if (d > 95) continue;
        _weakToDir.copy(_weakCand).sub(G.camera.position).normalize();
        const align = _weakToDir.dot(player.forward);
        if (align < 0.15) continue;
        const score = d * (1.4 - align);
        if (score < bestScore) {
          bestScore = score;
          _weakOut.copy(_weakCand);
          hasBest = true;
        }
      }
    }
    return hasBest ? _weakOut : null;
  }

  function spawnDeflectedSpear(origin: any, dir: any, damage: number, homing: boolean) {
    let slot: DeflectedSpear | null = null;
    for (let i = 0; i < deflectSpears.length; i++) {
      if (!deflectSpears[i].active) {
        slot = deflectSpears[i];
        break;
      }
    }
    if (!slot) slot = deflectSpears[0];
    slot.active = true;
    slot.originPos.copy(origin);
    slot.pos.copy(origin);
    slot.dir.copy(dir).normalize();
    slot.speed = 112;
    slot.damage = damage;
    slot.life = 1.45;
    slot.traveledDist = 0;
    slot.homing = homing;
  }

  function flushWorldProjectiles() {
    genjiWeapon.clearProjectiles();
    gunnerWeapon.clearProjectiles();
    hanzoWeapon.clearProjectiles();
    for (const sp of deflectSpears) sp.active = false;
    deflectOuterInst.count = 0;
    deflectCoreInst.count = 0;
    deflectOuterInst.instanceMatrix.needsUpdate = true;
    deflectCoreInst.instanceMatrix.needsUpdate = true;

    for (const arc of bossFlameArcs) {
      arc.active = false;
      arc.mesh.visible = false;
    }

    const enemyBolts: any[] =
      G.enemies && G.enemies.debug && G.enemies.debug.bolts ? G.enemies.debug.bolts : [];
    for (let i = 0; i < enemyBolts.length; i++) {
      if (enemyBolts[i].on) {
        enemyBolts[i].on = false;
        enemyBolts[i].__sniper = false;
        enemyBolts[i].__mortar = false;
        enemyBolts[i].__colossus = false;
      }
    }
    if (G.enemies && G.enemies.debug && G.enemies.debug.boltMesh) {
      G.enemies.debug.boltMesh.count = 0;
      G.enemies.debug.boltMesh.instanceMatrix.needsUpdate = true;
    }
    (G.ecsCombat as EcsCombatBridge | undefined)?.syncProjectiles();
  }

  const _dbQ = new THREE.Quaternion();
  const _dbM = new THREE.Matrix4();
  const _dbS = new THREE.Vector3(1, 1, 1);
  const _zUnit = new THREE.Vector3(0, 0, 1);
  const _boltStart = new THREE.Vector3();
  const _boltEnd = new THREE.Vector3();
  const _parryPt = new THREE.Vector3();
  const _spearBack = new THREE.Vector3();

  const _deflectAim = new THREE.Vector3();
  const _deflectDir = new THREE.Vector3();
  const _homingDesired = new THREE.Vector3();

  function updateDeflectSystem(dt: number) {
    // 1. Swept-Segment Anti-Tunneling Bullet Catch while `E` Deflect is active!
    const enemyBolts: any[] = G.enemies && G.enemies.debug && G.enemies.debug.bolts ? G.enemies.debug.bolts : [];
    if (activeHero === 'genji' && cdState.deflectActiveT > 0 && player.alive) {
      for (let i = 0; i < enemyBolts.length; i++) {
        const b = enemyBolts[i];
        if (!b.on) continue;

        const estStep = (b.__sniper ? 92 : b.__mortar ? 45 : 56) * dt + 1.75;
        _boltStart.copy(b.pos).addScaledVector(b.dir, -0.95);
        _boltEnd.copy(b.pos).addScaledVector(b.dir, estStep);

        const swept = checkSweptBoltDeflect({
          playerEye: player.eye,
          playerForward: player.forward,
          boltStart: _boltStart,
          boltEnd: _boltEnd,
          boltDir: b.dir,
          shieldDist: 1.45,
          shieldRadius: 2.85,
          maxRange: 5.8,
          minCos: 0.2,
        });

        if (swept.hit) {
          const wasSniper = !!b.__sniper;
          const wasColossus = !!b.__colossus;
          b.on = false;
          b.__sniper = false;
          b.__mortar = false;
          b.__colossus = false;
          _parryPt.set(swept.point.x, swept.point.y, swept.point.z);

          const weakTarget = buildStats.deflectHomingWeakspot ? findNearestEnemyWeakspot(_parryPt) : null;
          let aimTarget: any = weakTarget;
          if (!aimTarget) {
            const wHit = G.physics.raycast(G.camera.position, player.forward, 180);
            const maxAim = wHit ? wHit.dist : 180;
            const cHit = raycastColossalBoss(G.camera.position, player.forward, maxAim);
            const eHit = G.enemies.raycast(G.camera.position, player.forward, cHit ? cHit.dist : maxAim);
            aimTarget = eHit
              ? eHit.point
              : cHit
                ? cHit.point
                : wHit
                  ? wHit.point
                  : _deflectAim.copy(G.camera.position).addScaledVector(player.forward, 110);
          }

          const refVec = computeDeflectDirection(_parryPt, player.forward, aimTarget);
          _deflectDir.set(refVec.x, refVec.y, refVec.z);
          const dmg = (wasColossus ? 84 : wasSniper ? 96 : 54) * buildStats.deflectMultiplier;

          spawnDeflectedSpear(_parryPt, _deflectDir, dmg, buildStats.deflectHomingWeakspot || wasColossus);
          genjiWeapon.addAmmo(3);

          // Unmistakable Parry Clang + 3D Shockwave Ring & Radial Steel Sparks + Hitstop + FOV Punch!
          audio.deflectParry();
          genjiWeapon.onDeflectParry(_parryPt);
          hitstopT = Math.max(hitstopT, 0.028);
          fovKick = Math.min(10.5, fovKick + 2.3);
          player.addShake(0.14);

          if (buildStats.deflectHealPerBolt > 0) {
            player.heal(buildStats.deflectHealPerBolt);
          }
          const extraUlt = buildStats.deflectHealPerBolt > 0 ? 55 : 32;
          cdState.ultCharge = addUltimateDamageCharge(
            cdState.ultCharge,
            extraUlt,
            buildStats.ultChargeMultiplier,
            cdState.dragonActiveT > 0
          );
          if (G.render && G.render.lightPool) {
            G.render.lightPool.flash(_parryPt, 0xffdc68, 22, 4.8, 0.08);
          }
        }
      }
    }

    // 2. Step active 2.6m Jade-Gold Reflected Spears against Colossal Boss, enemies & destructible village cover!
    let count = 0;
    const camPos = G.camera.position;
    for (let i = 0; i < deflectSpears.length; i++) {
      const sp = deflectSpears[i];
      if (!sp.active) continue;
      sp.life -= dt;
      if (
        sp.life <= 0 ||
        sp.traveledDist >= 135 ||
        isProjectileOutOfPlayableBounds(sp.pos, sp.originPos, 135)
      ) {
        sp.active = false;
        continue;
      }

      if (sp.homing) {
        const wt = findNearestEnemyWeakspot(sp.pos);
        if (wt) {
          _homingDesired.copy(wt).sub(sp.pos).normalize();
          sp.dir.lerp(_homingDesired, Math.min(1, dt * 16)).normalize();
        }
      }

      const step = Math.min(135 - sp.traveledDist, Math.max(0.05, sp.speed * dt));
      _spearBack.copy(sp.pos).addScaledVector(sp.dir, -0.16);
      const rawWall = G.physics.raycast(_spearBack, sp.dir, step + 0.16);
      const wHit = rawWall
        ? { dist: Math.max(0, rawWall.dist - 0.16), point: rawWall.point }
        : null;
      const dHit =
        G.level && typeof G.level.raycastDestructible === 'function'
          ? G.level.raycastDestructible(sp.pos, sp.dir, wHit ? wHit.dist + 0.2 : step)
          : null;
      const maxEnemyDist = Math.min(wHit ? wHit.dist : step, dHit ? dHit.dist : step);
      const cHit = raycastColossalBoss(sp.pos, sp.dir, maxEnemyDist);
      const eHit = G.enemies.raycast(sp.pos, sp.dir, cHit ? cHit.dist : maxEnemyDist);

      if (eHit && eHit.enemy) {
        const isWeak = eHit.part === 'weak' || sp.homing;
        const finalDmg = sp.damage * (isWeak ? 1.5 : 1.0);
        const killed = eHit.enemy.damage(finalDmg, eHit.point, sp.dir, isWeak ? 'weak' : eHit.part) === true;
        if (G.combat && G.combat.stats) {
          G.combat.stats.shots++;
          G.combat.stats.hits++;
        }
        G.events.emit('player:hitEnemy', { enemy: eHit.enemy, part: isWeak ? 'weak' : eHit.part, killed, weak: isWeak });
        genjiWeapon.spawnParryBurst(eHit.point, true);
        audio.bladeCleaveImpact(killed);
        if (killed) hitstopT = Math.max(hitstopT, 0.036);
        cdState.ultCharge = addUltimateDamageCharge(
          cdState.ultCharge,
          finalDmg,
          buildStats.ultChargeMultiplier,
          cdState.dragonActiveT > 0
        );
        sp.active = false;
        continue;
      }

      if (cHit) {
        const res = damageColossalBoss(sp.damage * 1.15, cHit.point, sp.dir, cHit.orbIndex, 'deflect');
        genjiWeapon.spawnParryBurst(cHit.point, true);
        audio.bladeCleaveImpact(res.killed || res.orbShattered);
        sp.active = false;
        continue;
      }

      if (dHit && dHit.item && G.level && typeof G.level.damageDestructible === 'function') {
        const res = G.level.damageDestructible(dHit.item, sp.damage * 0.9, dHit.point, sp.dir);
        audio.structureBreak(!!(res && res.destroyed));
        genjiWeapon.spawnParryBurst(dHit.point, false);
        sp.active = false;
        continue;
      }

      if (wHit) {
        genjiWeapon.spawnParryBurst(wHit.point, false);
        sp.active = false;
        continue;
      }

      sp.pos.addScaledVector(sp.dir, step);
      sp.traveledDist += step;
      const visScale = computeProjectileVisualScale(sp.pos.distanceTo(camPos), 1.0);
      _dbQ.setFromUnitVectors(_zUnit, sp.dir);
      _dbS.set(visScale, visScale, Math.min(1.8, visScale));
      _dbM.compose(sp.pos, _dbQ, _dbS);
      deflectOuterInst.setMatrixAt(count, _dbM);
      deflectCoreInst.setMatrixAt(count, _dbM);
      count++;
    }

    if (count > 0 || deflectOuterInst.count > 0) {
      deflectOuterInst.count = count;
      deflectCoreInst.count = count;
      deflectOuterInst.instanceMatrix.needsUpdate = true;
      deflectCoreInst.instanceMatrix.needsUpdate = true;
    }
  }

  // =========================================================================
  // VOLUMETRIC NEAR-PLANE-SAFE SNIPER LASER + POOLED ENEMY VARIANT AI (ZERO-GC)
  // =========================================================================
  const sniperOuterHaloGeo = new THREE.CylinderGeometry(0.032, 0.032, 1, 8, 1, true);
  sniperOuterHaloGeo.rotateX(Math.PI / 2);
  sniperOuterHaloGeo.translate(0, 0, 0.5);
  const sniperInnerCoreGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 6, 1, true);
  sniperInnerCoreGeo.rotateX(Math.PI / 2);
  sniperInnerCoreGeo.translate(0, 0, 0.5);
  const sniperGlintGeo = new THREE.OctahedronGeometry(0.095, 0);

  const sniperLaserUniforms = {
    uTime: { value: 0 },
    uUrgent: { value: 0 },
  };
  const sniperOuterHaloMat = new THREE.ShaderMaterial({
    uniforms: sniperLaserUniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uUrgent;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float radialSoft = pow(ndv, 1.55);
        float endFade = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
        float dustWave = 0.72 + 0.28 * sin(vUv.y * 42.0 - uTime * 16.0);
        vec3 col = mix(vec3(1.0, 0.14, 0.08), vec3(1.0, 0.55, 0.28), uUrgent * 0.65);
        float alpha = radialSoft * endFade * dustWave * (0.36 + uUrgent * 0.26);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col * (2.2 + uUrgent * 0.8), clamp(alpha, 0.0, 0.78));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const sniperInnerCoreMat = new THREE.ShaderMaterial({
    uniforms: sniperLaserUniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uUrgent;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float core = pow(ndv, 2.2);
        float endFade = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        vec3 col = mix(vec3(1.0, 0.72, 0.65), vec3(1.0, 0.96, 0.88), core);
        float alpha = core * endFade * (0.78 + uUrgent * 0.20);
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(col * 3.0, clamp(alpha, 0.0, 0.96));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const sniperGlintQuadGeo = new THREE.PlaneGeometry(0.32, 0.32);
  const sniperMuzzleGlintMat = new THREE.ShaderMaterial({
    uniforms: sniperLaserUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uUrgent;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x) + uTime * 3.5;
        float rays = pow(abs(cos(ang * 2.0)), 12.0) * smoothstep(1.0, 0.05, r);
        float pin = exp(-r * r * 22.0);
        float a = clamp(pin * 0.95 + rays * (0.65 + uUrgent * 0.35), 0.0, 0.98) * smoothstep(1.0, 0.75, r);
        if (a < 0.015) discard;
        vec3 col = mix(vec3(1.0, 0.28, 0.14), vec3(1.0, 0.95, 0.85), clamp(pin * 1.2 + rays * 0.3, 0.0, 1.0));
        gl_FragColor = vec4(col * 2.8, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  function ensureSniperLaser(en: any) {
    if (en.__laserMesh) return en.__laserMesh;
    const grp = new THREE.Group();
    grp.visible = false;
    grp.frustumCulled = false;

    const beamGroup = new THREE.Group();
    beamGroup.frustumCulled = false;
    const outerHalo = new THREE.Mesh(sniperOuterHaloGeo, sniperOuterHaloMat);
    outerHalo.frustumCulled = false;
    outerHalo.renderOrder = 6;
    const innerCore = new THREE.Mesh(sniperInnerCoreGeo, sniperInnerCoreMat);
    innerCore.frustumCulled = false;
    innerCore.renderOrder = 7;
    beamGroup.add(outerHalo, innerCore);

    const glintStar = new THREE.Mesh(sniperGlintQuadGeo, sniperMuzzleGlintMat);
    glintStar.frustumCulled = false;
    glintStar.renderOrder = 8;

    grp.add(beamGroup, glintStar);
    grp.userData.beamGroup = beamGroup;
    grp.userData.glintStar = glintStar;
    G.scene.add(grp);
    en.__laserMesh = grp;
    return grp;
  }

  // Collect high-ground rooftop & watchtower sniper perches across the 188x168m classical village
  const sniperPerches: any[] = [];
  if (G.level && Array.isArray(G.level.sniperPerches)) {
    for (const p of G.level.sniperPerches) {
      sniperPerches.push(p.clone());
    }
  }
  if (G.level && G.level.vantage && G.level.vantage.roof) {
    sniperPerches.push(G.level.vantage.roof.clone());
  }

  let activeBoss: any = null;

  function resetVariantDecor(en: any) {
    en.__variant = 'normal';
    en.__hitR2 = 2.6;
    if (en.__origDamage) {
      en.damage = en.__origDamage;
    }
    if (en.rig && en.rig.group) {
      en.rig.group.scale.setScalar(1);
    }
    // Restore underlying engine SkinnedMesh so `hound` (`机械狗`) & `gull` (`无人机`) stay 100% original!
    setBaseEnemySkinnedMeshVisible(en, true);
    if (en.__samuraiRig && Array.isArray(en.__samuraiRig.parts)) {
      for (const part of en.__samuraiRig.parts) {
        part.visible = false;
      }
    }
    if (en.__bossDecor) en.__bossDecor.visible = false;
    if (en.__jingasa) en.__jingasa.visible = false;
    if (en.__laserMesh) en.__laserMesh.visible = false;
    if (en.__spiderDecor) en.__spiderDecor.visible = false;
    if (en.__shieldDecor) en.__shieldDecor.visible = false;
    if (en.__crabDecor) en.__crabDecor.visible = false;
  }

  function spawnGenjiVariant(
    variant: GenjiEnemyVariant,
    pos: any,
    hpScale: number,
    waveNum: number
  ): any {
    const baseType =
      variant === 'swarm' || variant === 'gull'
        ? 'gull'
        : variant === 'hound' || variant === 'spider_mech' || variant === 'mortar_crab'
          ? 'hound'
          : 'trooper';

    const en = G.enemies.spawn(baseType, pos, { state: 'alert' });
    if (!en) return null;

    resetVariantDecor(en);
    en.__variant = variant;

    if (variant === 'swarm') {
      en.rig.group.scale.setScalar(0.76);
      en.hp = Math.round(42 * hpScale);
      en.__maxHp = en.hp;
    } else if (variant === 'gull') {
      en.hp = Math.round(64 * hpScale);
      en.__maxHp = en.hp;
    } else if (variant === 'hound') {
      en.hp = Math.round(92 * hpScale);
      en.__maxHp = en.hp;
    } else if (variant === 'spider_mech') {
      en.rig.group.scale.setScalar(1.18);
      en.__hitR2 = 4.2;
      en.hp = Math.round(138 * hpScale);
      en.__maxHp = en.hp;
      en.__spiderFireT = 1.2 + rng() * 0.8;
      en.__spiderGaitT = rng() * 6.28;
      buildMasterworkSpiderMechRig(G, en).visible = true;
    } else if (variant === 'mortar_crab') {
      en.rig.group.scale.setScalar(1.22);
      en.__hitR2 = 4.6;
      en.hp = Math.round(162 * hpScale);
      en.__maxHp = en.hp;
      en.__mortarFireT = 1.6 + rng() * 0.9;
      en.__crabGaitT = rng() * 6.28;
      buildMasterworkMortarCrabRig(G, en).visible = true;
    } else if (variant === 'shield_guard') {
      en.rig.group.scale.setScalar(1.14);
      en.__hitR2 = 3.6;
      en.hp = Math.round(156 * hpScale);
      en.__maxHp = en.hp;
      en.__shieldFlashT = 0;
      applyKarakuriSamuraiRig(G, en, 'shield_guard');
      buildMasterworkShieldGuardAttachment(G, en).visible = true;
      if (!en.__origDamage) {
        en.__origDamage = en.damage.bind(en);
      }
      en.damage = (rawAmt: number, hitPt: any, hitDir: any, part: string) => {
        const toSrc =
          hitDir && (hitDir.x || hitDir.z)
            ? { x: -hitDir.x, y: -(hitDir.y || 0), z: -hitDir.z }
            : { x: player.pos.x - en.pos.x, y: 0, z: player.pos.z - en.pos.z };
        const bypassOnce = !!en.__bypassShieldOnce;
        en.__bypassShieldOnce = false;
        const res = computeShieldedEnemyDamage({
          rawDamage: rawAmt,
          toSourceDir: toSrc,
          enemyForward: en.fwd || { x: Math.sin(en.yaw || 0), y: 0, z: Math.cos(en.yaw || 0) },
          isWeakspot: part === 'weak' || part === 'head',
          bypassShield: bypassOnce || part === 'splash' || part === 'dragonblade',
        });
        if (res.blocked) {
          en.__shieldFlashT = 0.16;
          audio.shieldRicochet();
          if (hitPt) genjiWeapon.spawnParryBurst(hitPt, false);
        }
        return en.__origDamage(res.finalDamage, hitPt, hitDir, part);
      };
    } else if (variant === 'trooper') {
      en.rig.group.scale.setScalar(1.05);
      en.hp = Math.round(86 * hpScale);
      en.__maxHp = en.hp;
      applyKarakuriSamuraiRig(G, en, 'trooper');
    } else if (variant === 'sniper') {
      en.rig.group.scale.setScalar(1.08);
      en.hp = Math.round(78 * hpScale);
      en.__maxHp = en.hp;
      if (!en.__perchPos) en.__perchPos = new THREE.Vector3();
      en.__perchPos.copy(pos);
      en.__sniperWindup = 0.95 + rng() * 0.45;
      en.__sniperCooldown = 0;
      applyKarakuriSamuraiRig(G, en, 'sniper');
      ensureSniperLaser(en);
    } else if (variant === 'boss') {
      en.rig.group.scale.setScalar(1.86);
      en.__hitR2 = 8.4;
      en.hp = Math.round(820 + waveNum * 175);
      en.__maxHp = en.hp;
      en.__bossTimer = 1.35;
      en.__bossPattern = 0;
      applyKarakuriSamuraiRig(G, en, 'boss');
      activeBoss = en;
    }

    return en;
  }

  const _aiOrigin = new THREE.Vector3();
  const _aiDir = new THREE.Vector3();
  const _aiBoltDir = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _multiLegParams = {
    phase: 0,
    moveIntensity: 0,
    turnRateNorm: 0,
    groupIndex: 0 as 0 | 1,
    side: 1 as 1 | -1,
    strideYawAmp: 0.32,
    liftAmp: 0.28,
  };
  const _multiLegPoseOut = {
    coxaYawDelta: 0,
    femurLift: 0,
    tibiaFlex: 0,
    isGrounded: true,
  };

  function updateSpecialEnemyBehaviors(dt: number) {
    if (!G.enemies || !G.enemies.list) return;
    const fireCtx = G.enemies.debug && G.enemies.debug.ctx;
    sniperLaserUniforms.uTime.value = runStats.time;
    if (enemyPbr.shieldHexBarrier && enemyPbr.shieldHexBarrier.uniforms) {
      enemyPbr.shieldHexBarrier.uniforms.uTime.value = runStats.time;
      enemyPbr.shieldHexBarrier.uniforms.uFlash.value = 0;
    }

    for (const en of G.enemies.list) {
      if (!en.alive) {
        if (en.__laserMesh) en.__laserMesh.visible = false;
        continue;
      }

      // Tick bleed DoT (`裂甲透骨镖` / `透甲鸣镝`)
      if (en.__bleedT && en.__bleedT > 0 && en.__bleedDps > 0) {
        en.__bleedT = Math.max(0, en.__bleedT - dt);
        en.__bleedAcc = (en.__bleedAcc || 0) + en.__bleedDps * dt;
        if (en.__bleedAcc >= 6) {
          const tickDmg = Math.floor(en.__bleedAcc);
          en.__bleedAcc -= tickDmg;
          en.damage(tickDmg, en.pos, _zUnit, 'splash');
          if (!en.alive) {
            if (en.__laserMesh) en.__laserMesh.visible = false;
            continue;
          }
        }
      }

      // 0. Perimeter Air-Wall Containment for ALL Ground & Flying Enemies
      const isFlyingDrone = en.type === 'gull';
      const airClamp = clampActorToAirWall({
        pos: en.pos,
        vel: en.vel,
        isFlying: isFlyingDrone,
      });
      if (airClamp.clampedX || airClamp.clampedY || airClamp.clampedZ) {
        en.pos.set(airClamp.pos.x, airClamp.pos.y, airClamp.pos.z);
        if (en.vel) {
          en.vel.set(airClamp.vel.x, airClamp.vel.y, airClamp.vel.z);
        }
        if (en.home) {
          en.home.x = clamp(en.home.x, -64, 68);
          en.home.z = clamp(en.home.z, -42, 42);
        }
      }

      // Compute actual world-space locomotion speed + yaw rate so stationary mechs NEVER paddle legs in place!
      const prevEX = en.__prevAnimX !== undefined ? en.__prevAnimX : en.pos.x;
      const prevEZ = en.__prevAnimZ !== undefined ? en.__prevAnimZ : en.pos.z;
      const prevEYaw = en.__prevAnimYaw !== undefined ? en.__prevAnimYaw : (en.yaw || 0);
      en.__prevAnimX = en.pos.x;
      en.__prevAnimZ = en.pos.z;
      en.__prevAnimYaw = en.yaw || 0;
      let yawDelta = (en.yaw || 0) - prevEYaw;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      const rawDispSpd =
        dt > 1e-4
          ? Math.hypot(en.pos.x - prevEX, en.pos.z - prevEZ) / dt + Math.abs(yawDelta / dt) * 0.28
          : 0;
      en.__animMoveSpd =
        en.__animMoveSpd === undefined ? rawDispSpd : damp(en.__animMoveSpd, rawDispSpd, 14, dt);

      const turnRateNorm = dt > 1e-4 ? clamp((yawDelta / dt) / 3.2, -1, 1) : 0;

      // 1. Quadruped Spider Mech (`四足重装机关蜘蛛`): displacement-synced diagonal trot (`FR+RL` vs `FL+RR`) + 3-DOF knees + hull suspension!
      if (en.__variant === 'spider_mech') {
        const moveRatio = clamp01(en.__animMoveSpd / 4.2);
        if (moveRatio > 0.02 || Math.abs(turnRateNorm) > 0.04) {
          en.__spiderGaitT = (en.__spiderGaitT || 0) + dt * Math.max(en.__animMoveSpd, Math.abs(turnRateNorm) * 2.2) * 0.56;
        }
        const cycle = (en.__spiderGaitT || 0) % 1;
        if (en.__spiderLegs) {
          _multiLegParams.phase = cycle * Math.PI * 2;
          _multiLegParams.moveIntensity = moveRatio;
          _multiLegParams.turnRateNorm = turnRateNorm;
          _multiLegParams.strideYawAmp = 0.34;
          _multiLegParams.liftAmp = 0.32;
          for (const lg of en.__spiderLegs) {
            _multiLegParams.groupIndex = lg.diag ? 1 : 0;
            _multiLegParams.side = lg.side >= 0 ? 1 : -1;
            const pose = computeMultiLegGaitPose(_multiLegParams, _multiLegPoseOut);
            lg.hip.rotation.y = lg.baseYaw + pose.coxaYawDelta;
            if (lg.femurPivot) {
              lg.femurPivot.rotation.x = -pose.femurLift * 0.95;
            }
            if (lg.tibiaPivot) {
              lg.tibiaPivot.rotation.x = pose.tibiaFlex * 0.92;
            }
          }
        }
        if (en.__spiderChassis) {
          const breathe = Math.sin(runStats.time * 3.1 + (en.id || 0)) * 0.012;
          const trotBob = Math.cos(cycle * Math.PI * 4) * 0.022 * moveRatio;
          en.__spiderChassis.position.y = breathe + trotBob;
          en.__spiderChassis.rotation.z = Math.sin(cycle * Math.PI * 2) * 0.032 * moveRatio;
          en.__spiderChassis.rotation.x = 0.035 * moveRatio;
        }
        if (en.__spiderTurret && player.alive) {
          const worldYaw = Math.atan2(player.pos.x - en.pos.x, player.pos.z - en.pos.z);
          en.__spiderTurret.rotation.y = worldYaw - (en.yaw || 0);
        }
        en.__spiderFireT = (en.__spiderFireT ?? 1.8) - dt;
        if (en.__spiderFireT <= 0 && player.alive && fireCtx && fireCtx.fireBolt) {
          en.__spiderFireT = 2.15 + rng() * 0.55;
          _aiOrigin.set(en.pos.x, en.pos.y + 0.96, en.pos.z);
          const dist = _aiOrigin.distanceTo(player.eye);
          if (dist < 62 && G.physics.lineOfSight(_aiOrigin, player.eye)) {
            _aiDir.copy(player.eye).sub(_aiOrigin).normalize();
            for (let k = -1; k <= 1; k++) {
              _aiBoltDir.copy(_aiDir).applyAxisAngle(_yAxis, k * 0.055);
              fireCtx.fireBolt(_aiOrigin, _aiBoltDir, en);
            }
          }
        }
      }

      // 2. Hexapod Mortar Crab (`六足轰击机关蟹`): alternating tripod scuttle + 3-DOF femur/tibia claws + hydraulic mortar recoil!
      if (en.__variant === 'mortar_crab') {
        const moveRatio = clamp01(en.__animMoveSpd / 3.4);
        if (moveRatio > 0.02 || Math.abs(turnRateNorm) > 0.04) {
          en.__crabGaitT = (en.__crabGaitT || 0) + dt * Math.max(en.__animMoveSpd, Math.abs(turnRateNorm) * 2.0) * 0.68;
        }
        const cycle = (en.__crabGaitT || 0) % 1;
        if (en.__crabLegs) {
          _multiLegParams.phase = cycle * Math.PI * 2;
          _multiLegParams.moveIntensity = moveRatio;
          _multiLegParams.turnRateNorm = turnRateNorm;
          _multiLegParams.strideYawAmp = 0.28;
          _multiLegParams.liftAmp = 0.26;
          for (const cl of en.__crabLegs) {
            _multiLegParams.groupIndex = cl.groupIndex ? 1 : 0;
            _multiLegParams.side = cl.side >= 0 ? 1 : -1;
            const pose = computeMultiLegGaitPose(_multiLegParams, _multiLegPoseOut);
            // Coxa `rotation.y` sweeps leg fore-aft along ground; `femurPivot.rotation.z` lifts vertically; `tibiaPivot.rotation.z` tucks spike!
            cl.pivot.rotation.y = (cl.baseYaw || 0) + pose.coxaYawDelta;
            if (cl.femurPivot) {
              cl.femurPivot.rotation.z = cl.side * pose.femurLift * 0.88;
            }
            if (cl.tibiaPivot) {
              cl.tibiaPivot.rotation.z = -cl.side * pose.tibiaFlex * 0.82;
            }
          }
        }
        en.__crabRecoil = Math.max(0, (en.__crabRecoil || 0) - dt * 3.4);
        if (en.__crabChassis) {
          const breathe = Math.sin(runStats.time * 2.6 + (en.id || 0)) * 0.010;
          const tripodBob = Math.cos(cycle * Math.PI * 4) * 0.018 * moveRatio;
          en.__crabChassis.position.y = breathe + tripodBob - en.__crabRecoil * 0.065;
          en.__crabChassis.rotation.z = Math.sin(cycle * Math.PI * 2) * 0.026 * moveRatio;
          en.__crabChassis.rotation.x = -en.__crabRecoil * 0.12;
        }
        if (en.__crabClaws) {
          for (const cw of en.__crabClaws) {
            cw.clawArm.rotation.y =
              cw.baseYaw +
              cw.side * (Math.sin(runStats.time * 2.8 + cw.side) * 0.06 + moveRatio * 0.08);
          }
        }
        if (en.__crabMortarBarrels) {
          for (const brl of en.__crabMortarBarrels) {
            brl.position.y = -en.__crabRecoil * 0.14;
          }
        }
        en.__mortarFireT = (en.__mortarFireT ?? 2.4) - dt;
        if (en.__mortarFireT <= 0 && player.alive && fireCtx && fireCtx.fireBolt) {
          en.__mortarFireT = 2.55 + rng() * 0.65;
          _aiOrigin.set(en.pos.x, en.pos.y + 1.15, en.pos.z);
          _aiDir.copy(player.eye).sub(_aiOrigin);
          const horiz = Math.hypot(_aiDir.x, _aiDir.z);
          if (horiz > 5 && horiz < 68) {
            en.__crabRecoil = 1.0;
            _aiDir.y += Math.min(12.0, horiz * 0.24 + 2.2);
            _aiDir.normalize();
            fireCtx.fireBolt(_aiOrigin, _aiDir, en);
            const bolts = G.enemies.debug.bolts;
            for (let b = bolts.length - 1; b >= 0; b--) {
              if (bolts[b].on && bolts[b].pos.distanceToSquared(_aiOrigin) < 0.12) {
                bolts[b].__mortar = true;
                break;
              }
            }
            if (G.render && G.render.lightPool) {
              G.render.lightPool.flash(_aiOrigin, 0xff7830, 42, 8.5, 0.14);
            }
          }
        }
      }

      // 3. Shield Guard (`玄甲盾卫机关兵`): pulse octagonal hex-field ShaderMaterial when blocking frontal fire!
      if (en.__variant === 'shield_guard' && en.__shieldEnergyRim) {
        en.__shieldFlashT = Math.max(0, (en.__shieldFlashT || 0) - dt);
        const rimMat = en.__shieldEnergyRim.material;
        if (rimMat && rimMat.uniforms && en.__shieldFlashT > 0) {
          rimMat.uniforms.uFlash.value = Math.max(
            rimMat.uniforms.uFlash.value,
            clamp01(en.__shieldFlashT / 0.16)
          );
        }
      }

      // 4. Rooftop & Watchtower Teppo Sniper AI (Near-Plane-Safe Dual-Layer Aiming Laser!)
      if (en.__variant === 'sniper' && en.__perchPos) {
        const groundBelow = G.physics.groundHeight(en.__perchPos.x, en.__perchPos.z, en.__perchPos.y + 0.6);
        if (en.__perchPos.y - groundBelow > 0.6) {
          en.__perchPos.y = Math.max(groundBelow, en.__perchPos.y - 12 * dt);
        } else {
          en.__perchPos.y = groundBelow;
        }
        en.pos.copy(en.__perchPos);
        en.hasGoal = false;
        en.maxSpeed = 0;
        en.speed = 0;
        en.mode = 'engage';
        en.es = 'hold';
        en.cool = 99;

        const targetEye = player.eye;
        const dx = targetEye.x - en.pos.x;
        const dz = targetEye.z - en.pos.z;
        en.yaw = Math.atan2(dx, dz);

        if (en.muzzle && en.muzzle.lengthSq() > 0.01) {
          _aiOrigin.copy(en.muzzle);
        } else {
          _aiOrigin.set(en.pos.x + Math.sin(en.yaw) * 0.42, en.pos.y + 1.44, en.pos.z + Math.cos(en.yaw) * 0.42);
        }
        _aiDir.copy(targetEye).sub(_aiOrigin);
        const dist = _aiDir.length() || 1;
        _aiDir.multiplyScalar(1 / dist);
        const hasLos = dist < 96 && G.physics.lineOfSight(_aiOrigin, targetEye);

        const laser = ensureSniperLaser(en);
        if (hasLos && player.alive) {
          en.__sniperCooldown -= dt;
          if (en.__sniperCooldown <= 0) {
            en.__sniperWindup -= dt;
            const wHit = G.physics.raycast(_aiOrigin, _aiDir, dist);
            const seg = computeSniperLaserSegment({
              muzzlePos: _aiOrigin,
              playerEye: targetEye,
              worldHitDist: wHit ? wHit.dist : null,
              nearPlaneGuard: 0.34,
            });

            if (seg.visible) {
              laser.visible = true;
              laser.position.set(seg.start.x, seg.start.y, seg.start.z);
              _aiBoltDir.set(seg.dir.x, seg.dir.y, seg.dir.z);
              laser.quaternion.setFromUnitVectors(_zUnit, _aiBoltDir);
              const urgent = en.__sniperWindup < 0.26;
              sniperLaserUniforms.uUrgent.value = urgent ? 1.0 : 0.0;
              const pulse = urgent
                ? 1.55 + Math.sin(runStats.time * 42) * 0.35
                : 1.0 + Math.sin(runStats.time * 12) * 0.12;
              const beamGroup = laser.userData.beamGroup;
              const glintStar = laser.userData.glintStar;
              if (beamGroup) {
                beamGroup.scale.set(pulse, pulse, seg.length);
              }
              if (glintStar) {
                glintStar.lookAt(player.eye);
                glintStar.scale.setScalar(urgent ? 1.55 : 0.95);
              }
            } else {
              laser.visible = false;
            }

            if (en.__sniperWindup <= 0) {
              laser.visible = false;
              en.__sniperCooldown = 1.95 + rng() * 0.65;
              en.__sniperWindup = 0.92;
              if (fireCtx && fireCtx.fireBolt) {
                fireCtx.fireBolt(_aiOrigin, _aiDir, en);
                const bolts = G.enemies.debug.bolts;
                for (let b = bolts.length - 1; b >= 0; b--) {
                  if (bolts[b].on && bolts[b].pos.distanceToSquared(_aiOrigin) < 0.08) {
                    bolts[b].__sniper = true;
                    break;
                  }
                }
              }
              if (G.fx && G.fx.muzzleFlash) G.fx.muzzleFlash(_aiOrigin, _aiDir, { scale: 1.25 });
            }
          } else {
            laser.visible = false;
          }
        } else {
          laser.visible = false;
          en.__sniperWindup = Math.min(0.95, en.__sniperWindup + dt * 0.5);
        }
      }

      // 5. Aka-Zonae Oni Warlord Boss AI: fires dense 11-bolt fan salvos & 9-bolt cross volleys!
      if (en.__variant === 'boss' && player.alive) {
        en.mode = 'engage';
        en.__bossTimer -= dt;
        if (en.__bossTimer <= 0 && fireCtx && fireCtx.fireBolt) {
          en.__bossPattern = (en.__bossPattern + 1) % 2;
          en.__bossTimer = 2.05;
          _aiOrigin.set(en.pos.x, en.pos.y + 2.15, en.pos.z);
          _aiDir.copy(player.eye).sub(_aiOrigin).normalize();

          if (en.__bossPattern === 0) {
            for (let k = -5; k <= 5; k++) {
              _aiBoltDir.copy(_aiDir).applyAxisAngle(_yAxis, k * 0.068);
              fireCtx.fireBolt(_aiOrigin, _aiBoltDir, en);
            }
          } else {
            for (let k = -4; k <= 4; k++) {
              _aiBoltDir.copy(_aiDir).applyAxisAngle(_yAxis, k * 0.052);
              _aiBoltDir.y += k % 2 === 0 ? 0.028 : -0.02;
              _aiBoltDir.normalize();
              fireCtx.fireBolt(_aiOrigin, _aiBoltDir, en);
            }
          }
          if (G.render && G.render.lightPool) {
            G.render.lightPool.flash(_aiOrigin, 0xff5a24, 72, 14, 0.16);
          }
        }
      }

      // 6. Anti-Straggler Closing Nudge
      if (en.__variant !== 'sniper' && en.type !== 'gull' && player.alive) {
        const horizD = Math.hypot(en.pos.x - player.pos.x, en.pos.z - player.pos.z);
        const dyAbs = Math.abs(en.pos.y - player.pos.y);
        if (horizD > 34 || dyAbs > 5.2) {
          en.__stragglerT = (en.__stragglerT || 0) + dt;
          en.mode = 'engage';
          if (en.goal) {
            en.goal.copy(player.pos);
            en.hasGoal = true;
          }
          if (en.__stragglerT > 5.0 && (horizD > 40 || dyAbs > 6.0)) {
            _aiOrigin.set(en.pos.x, en.pos.y + 1.4, en.pos.z);
            const seen = horizD < 32 && G.physics.lineOfSight(_aiOrigin, player.eye);
            if (!seen) {
              const nearPt = pickSpawnPointForVariant(en.__variant || 'trooper');
              if (nearPt.distanceTo(player.pos) < horizD - 6) {
                en.pos.copy(nearPt);
                en.__stragglerT = 0;
              }
            }
          }
        } else {
          en.__stragglerT = 0;
        }
      }
    }

    if (activeBoss && !activeBoss.alive) {
      activeBoss = null;
    }
    (G.ecsCombat as EcsCombatBridge | undefined)?.markEnemiesDirty();
  }

  // =========================================================================
  // COLOSSAL GIANT BOSS (`荒神大天狗 · 八岐鬼王丸`, 7.8m Tall + 4 Raijin Orbs)
  // =========================================================================
  let colossusState: ColossalBossState | null = null;
  const colossusPos = new THREE.Vector3(0, 0, 0);
  let colossusYaw = Math.PI;
  let colossusAnimTime = 0;
  let colossusHitFlashT = 0;
  let colossusDeathT = 0;
  let colossusSlamFired = false;
  let colossusShockwaveT = 0;
  let colossusShockwaveHitPlayer = false;
  const colossusShockwaveOrigin = new THREE.Vector3();
  const colossusLeapStart = new THREE.Vector3();
  const colossusLeapEnd = new THREE.Vector3();
  const colossusOrbWorldPos = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];

  // Radial polar GLSL shader for non-rectangular Colossal Boss Ground-Slam Telegraph & Expanding Shockwave Ring
  const matColossusRingShader = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uMode: { value: 0 }, // 0 = windup telegraph, 1 = expanding shockwave
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      uniform float uMode;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        if (uMode < 0.5) {
          float outerRim = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
          float fillWave = smoothstep(uProgress - 0.14, uProgress, r) * (1.0 - smoothstep(uProgress, uProgress + 0.04, r));
          float runeSpokes = 0.5 + 0.5 * cos(ang * 8.0 + uProgress * 6.283);
          float alpha = outerRim * (0.55 + 0.35 * runeSpokes) + fillWave * 0.65 + (1.0 - r) * 0.12 * uProgress;
          vec3 col = mix(vec3(1.0, 0.24, 0.08), vec3(1.0, 0.84, 0.32), outerRim + fillWave * 0.6);
          gl_FragColor = vec4(col * 2.1, clamp(alpha, 0.0, 0.92));
        } else {
          float ringR = max(0.08, uProgress);
          float band = exp(-pow((r - ringR) * 9.5, 2.0));
          float jag = 0.78 + 0.22 * sin(ang * 12.0 - uProgress * 18.0);
          float fade = 1.0 - smoothstep(0.72, 1.0, uProgress);
          float alpha = band * jag * fade;
          if (alpha < 0.02) discard;
          vec3 col = mix(vec3(1.0, 0.26, 0.06), vec3(1.0, 0.92, 0.52), band);
          gl_FragColor = vec4(col * 2.6, clamp(alpha, 0.0, 0.96));
        }
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const enemyPbr = getEnemyPbrSuite(G);
  const matColossusEbony = enemyPbr.karakuriIron.clone();
  const matColossusCrimson = enemyPbr.akazonaeLacquer.clone();
  const matColossusGold = enemyPbr.kinkoGold.clone();
  const matColossusMane = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.92, 0.89, 0.84),
    roughness: 0.82,
    metalness: 0.04,
  });
  const matColossusFlame = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float silhouetteSoft = pow(ndv, 1.15);
        float endFade = smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
        float turbA = sin(vUv.y * 26.0 - uTime * 15.0 + sin(vUv.x * 12.56) * 1.6) * 0.5 + 0.5;
        float turbB = sin(vUv.y * 43.0 + uTime * 21.0 - cos(vUv.x * 18.84) * 1.2) * 0.5 + 0.5;
        float flame = clamp(turbA * 0.62 + turbB * 0.38, 0.0, 1.0);
        vec3 deepCrimson = vec3(0.95, 0.16, 0.03);
        vec3 brightAmber = vec3(1.0, 0.62, 0.14);
        vec3 hotGold = vec3(1.0, 0.95, 0.62);
        vec3 col = mix(deepCrimson, brightAmber, flame);
        col = mix(col, hotGold, pow(flame * ndv, 2.0));
        float alpha = silhouetteSoft * endFade * (0.45 + flame * 0.55);
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(col * 2.4, clamp(alpha, 0.0, 0.94));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const matOrbCore = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffd458).multiplyScalar(2.8),
    toneMapped: false,
  });

  const colossusRoot = new THREE.Group();
  colossusRoot.visible = false;
  colossusRoot.frustumCulled = false;
  G.scene.add(colossusRoot);

  // Ground contact shadow beneath the 7.8m Colossus
  const colossusShadow = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 24),
    new THREE.MeshBasicMaterial({
      color: 0x050304,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    })
  );
  colossusShadow.rotation.x = -Math.PI / 2;
  colossusShadow.position.y = 0.03;
  colossusRoot.add(colossusShadow);

  // Articulated Body Hierarchy (`pelvis -> chest -> head / swordArm / raijinWheel` + `thigh -> kneePivot -> shin/foot`)
  const colossusBody = new THREE.Group();
  colossusRoot.add(colossusBody);

  const colLegL = new THREE.Group();
  colLegL.position.set(-0.92, 2.55, 0);
  const colLegR = new THREE.Group();
  colLegR.position.set(0.92, 2.55, 0);
  const colKneeL = new THREE.Group();
  colKneeL.position.set(0, -1.32, 0);
  const colKneeR = new THREE.Group();
  colKneeR.position.set(0, -1.32, 0);
  for (const [leg, kneePivot] of [
    [colLegL, colKneeL],
    [colLegR, colKneeR],
  ] as const) {
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.42, 1.45, 10), matColossusEbony);
    thigh.position.y = -0.68;
    const haidate = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.64, 0.85, 8), matColossusCrimson);
    haidate.position.y = -0.45;
    const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 1), matColossusGold);
    knee.position.set(0, 0, 0.34);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 1.32, 10), matColossusCrimson);
    shin.position.y = -0.60;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 0.28, 8), matColossusEbony);
    foot.position.set(0, -1.12, 0.16);
    kneePivot.add(knee, shin, foot);
    leg.add(thigh, haidate, kneePivot);
    colossusBody.add(leg);
  }

  const colChest = new THREE.Group();
  colChest.position.set(0, 2.65, 0);
  colossusBody.add(colChest);

  // Great O-Yoroi Cuirass (`胴丸`) + Kusazuri armored waist tassets
  const colBelly = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.08, 1.35, 12), matColossusEbony);
  colBelly.position.y = 0.65;
  const colCuirass = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.30, 1.65, 12), matColossusCrimson);
  colCuirass.position.y = 1.85;
  const colGoldTrim = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.09, 8, 24), matColossusGold);
  colGoldTrim.rotation.x = Math.PI / 2;
  colGoldTrim.position.y = 2.52;
  const colChestCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 1), matOrbCore);
  colChestCrest.scale.set(1.1, 1.35, 0.45);
  colChestCrest.position.set(0, 1.95, 1.42);
  colChest.add(colBelly, colCuirass, colGoldTrim, colChestCrest);

  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2;
    const tasset = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.58, 0.95, 6), matColossusCrimson);
    tasset.scale.set(1.0, 1.0, 0.28);
    tasset.position.set(Math.sin(ang) * 1.18, 0.12, Math.cos(ang) * 1.18);
    tasset.rotation.y = ang;
    tasset.rotation.x = 0.22;
    colChest.add(tasset);
  }

  // Twin 4-Tiered O-Sode Great Samurai Shoulder Shields
  for (const side of [-1, 1]) {
    const sode = new THREE.Group();
    sode.position.set(side * 1.88, 2.38, 0);
    sode.rotation.z = -side * 0.30;
    for (let t = 0; t < 4; t++) {
      const tierMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.72, 0.80, 0.34, 8),
        t === 0 ? matColossusGold : matColossusCrimson
      );
      tierMesh.scale.set(0.35, 1.0, 1.15);
      tierMesh.position.y = 0.32 - t * 0.30;
      sode.add(tierMesh);
    }
    colChest.add(sode);
  }

  // Sculpted Oni-Tengu Colossal Head (`y ~ 5.65m` to `7.8m` horn tips)
  const colHead = new THREE.Group();
  colHead.position.set(0, 2.95, 0.18);
  colChest.add(colHead);

  const tenguSkull = new THREE.Mesh(new THREE.SphereGeometry(0.78, 14, 12), matColossusCrimson);
  tenguSkull.scale.set(0.96, 1.12, 1.05);
  tenguSkull.position.y = 0.55;
  const tenguNose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.95, 8), matColossusCrimson);
  tenguNose.rotation.x = Math.PI * 0.54;
  tenguNose.position.set(0, 0.48, 0.98);
  const kabutoDome = new THREE.Mesh(new THREE.SphereGeometry(0.86, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), matColossusEbony);
  kabutoDome.position.y = 0.66;
  const shikoroNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1.18, 0.58, 10, 1, true), matColossusEbony);
  shikoroNeck.position.set(0, 0.36, -0.14);
  colHead.add(tenguSkull, tenguNose, kabutoDome, shikoroNeck);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), matOrbCore);
    eye.scale.set(1.5, 0.65, 0.7);
    eye.position.set(side * 0.32, 0.62, 0.68);
    eye.rotation.z = -side * 0.28;
    colHead.add(eye);

    // Sweeping curved Golden Kuwagata Great Horns (`TubeGeometry`) soaring up to 7.8m!
    const hornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.22, 0.95, 0.42),
      new THREE.Vector3(side * 0.85, 1.55, 0.36),
      new THREE.Vector3(side * 1.28, 2.28, 0.12),
      new THREE.Vector3(side * 0.96, 2.88, -0.12),
    ]);
    const hornMesh = new THREE.Mesh(new THREE.TubeGeometry(hornCurve, 12, 0.095, 6, false), matColossusGold);
    colHead.add(hornMesh);
  }

  // Wild White Yokai Mane (`白发狮鬃`)
  for (let m = -2; m <= 2; m++) {
    const maneCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(m * 0.26, 0.82, -0.35),
      new THREE.Vector3(m * 0.42, 0.35, -0.92),
      new THREE.Vector3(m * 0.55, -0.38, -1.18),
    ]);
    const maneLock = new THREE.Mesh(new THREE.TubeGeometry(maneCurve, 8, 0.13, 5, false), matColossusMane);
    colHead.add(maneLock);
  }

  // Left Guard Arm & Right Colossal Odachi Sword Arm (`5.6m` Blazing Great-Blade)
  const colArmL = new THREE.Group();
  colArmL.position.set(-1.75, 2.22, 0.15);
  const armLUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.30, 1.45, 8), matColossusEbony);
  armLUpper.position.y = -0.65;
  armLUpper.rotation.z = 0.28;
  const armLFore = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 1.35, 8), matColossusCrimson);
  armLFore.position.set(-0.35, -1.65, 0.48);
  armLFore.rotation.x = -0.65;
  colArmL.add(armLUpper, armLFore);
  colChest.add(colArmL);

  const colSwordArm = new THREE.Group();
  colSwordArm.position.set(1.78, 2.28, 0.18);
  colChest.add(colSwordArm);

  const armRUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 1.5, 8), matColossusEbony);
  armRUpper.position.y = -0.68;
  const armRFore = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 1.35, 8), matColossusCrimson);
  armRFore.position.set(0, -1.75, 0.42);
  armRFore.rotation.x = -0.55;
  colSwordArm.add(armRUpper, armRFore);

  const odachiGroup = new THREE.Group();
  odachiGroup.position.set(0, -2.18, 0.85);
  odachiGroup.rotation.x = 0.92;
  const odachiTsuka = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.10, 1.35, 8), matColossusEbony);
  odachiTsuka.position.y = -0.55;
  const odachiTsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 12), matColossusGold);
  odachiTsuba.position.y = 0.15;
  const odachiCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.2, 0),
    new THREE.Vector3(0, 2.1, -0.08),
    new THREE.Vector3(0, 4.0, -0.26),
    new THREE.Vector3(0, 5.55, -0.54),
  ]);
  const odachiBlade = new THREE.Mesh(new THREE.TubeGeometry(odachiCurve, 16, 0.11, 4, false), matColossusGold);
  odachiBlade.scale.set(0.32, 1.0, 1.35);
  const odachiFlame = new THREE.Mesh(new THREE.TubeGeometry(odachiCurve, 14, 0.19, 6, false), matColossusFlame);
  odachiFlame.scale.set(0.28, 1.0, 1.5);
  odachiGroup.add(odachiTsuka, odachiTsuba, odachiBlade, odachiFlame);
  colSwordArm.add(odachiGroup);

  // Rotating Raijin Taiko Back-Halo (`雷神背光轮`) + 4 Shatterable Weakspot Orbs!
  const colRaijinWheel = new THREE.Group();
  colRaijinWheel.position.set(0, 2.55, -0.78);
  colChest.add(colRaijinWheel);

  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.095, 8, 36), matColossusGold);
  colRaijinWheel.add(wheelRing);

  const colOrbMeshes: any[] = [];
  const orbBaseAngles = [Math.PI * 0.2, Math.PI * 0.42, Math.PI * 0.58, Math.PI * 0.8];
  for (let i = 0; i < 4; i++) {
    const orbGrp = new THREE.Group();
    const ang = orbBaseAngles[i];
    orbGrp.position.set(Math.cos(ang) * 2.65, Math.sin(ang) * 2.15 + 0.35, 0);
    const drumFrame = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.065, 8, 20), matColossusCrimson);
    const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.44, 14, 12), matOrbCore);
    const haloSphere = new THREE.Mesh(new THREE.SphereGeometry(0.64, 12, 10), matColossusFlame);
    orbGrp.add(drumFrame, coreSphere, haloSphere);
    colRaijinWheel.add(orbGrp);
    colOrbMeshes.push(orbGrp);
  }

  // World-space Ground Telegraph & Expanding Shockwave Ring Meshes
  const colTelegraphMat = matColossusRingShader.clone();
  colTelegraphMat.uniforms = { uProgress: { value: 0 }, uMode: { value: 0 } };
  const colTelegraphMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), colTelegraphMat);
  colTelegraphMesh.rotation.x = -Math.PI / 2;
  colTelegraphMesh.visible = false;
  colTelegraphMesh.frustumCulled = false;
  G.scene.add(colTelegraphMesh);

  const colShockwaveMat = matColossusRingShader.clone();
  colShockwaveMat.uniforms = { uProgress: { value: 0 }, uMode: { value: 1 } };
  const colShockwaveMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), colShockwaveMat);
  colShockwaveMesh.rotation.x = -Math.PI / 2;
  colShockwaveMesh.visible = false;
  colShockwaveMesh.frustumCulled = false;
  G.scene.add(colShockwaveMesh);

  // Boss Flame Crescent Projectile Pool (2 sweeping crimson-gold polar arcs!)
  interface BossFlameArc {
    active: boolean;
    pos: any;
    dir: any;
    life: number;
    mesh: any;
  }
  const bossFlameArcs: BossFlameArc[] = [];
  for (let i = 0; i < 4; i++) {
    const arcGeo = new THREE.TorusGeometry(2.15, 0.14, 6, 20, Math.PI * 0.78);
    const arcMesh = new THREE.Mesh(arcGeo, matColossusFlame);
    arcMesh.visible = false;
    arcMesh.frustumCulled = false;
    G.scene.add(arcMesh);
    bossFlameArcs.push({
      active: false,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1),
      life: 0,
      mesh: arcMesh,
    });
  }

  function syncColossusOrbWorldPositions() {
    colossusRoot.updateMatrixWorld(true);
    for (let i = 0; i < 4; i++) {
      colOrbMeshes[i].getWorldPosition(colossusOrbWorldPos[i]);
    }
  }

  function spawnColossalBoss(waveNum: number, nearPlayer = false) {
    if (colossusState && colossusState.hp > 0) return;
    colossusState = createColossalBossState(Math.max(1, waveNum));
    colossusDeathT = 0;
    colossusHitFlashT = 0;
    colossusSlamFired = false;
    colossusShockwaveT = 0;

    // Pick a dramatic clear street/courtyard arena spot (avoiding narrow sky-bridge roofs at x = -47 and x = -21!)
    let targetX = player.pos.x + player.forward.x * 19;
    let targetZ = player.pos.z + player.forward.z * 19;
    if (player.pos.x < -36 && Math.abs(player.pos.z) < 12) {
      targetX = -34.0;
      targetZ = 0.0;
    } else if (!nearPlayer && Math.abs(player.pos.x) > 45) {
      targetX = clamp(player.pos.x + 21, -54, 58);
      targetZ = clamp(player.pos.z * 0.4, -18, 18);
    } else {
      targetX = clamp(targetX, -62, 68);
      targetZ = clamp(targetZ, -38, 38);
      if (Math.abs(targetX - -47) < 3.6) targetX = -39.5;
      if (Math.abs(targetX - -21) < 3.6) targetX = -14.5;
    }
    const groundY = G.physics.groundHeight(targetX, targetZ, player.pos.y + 3.2);
    colossusPos.set(targetX, Number.isFinite(groundY) ? Math.max(0, groundY) : 0, targetZ);
    colossusYaw = Math.atan2(player.pos.x - colossusPos.x, player.pos.z - colossusPos.z);

    colossusRoot.position.copy(colossusPos);
    colossusRoot.rotation.set(0, colossusYaw, 0);
    colossusRoot.scale.setScalar(1);
    colossusRoot.visible = true;
    for (let i = 0; i < 4; i++) {
      colOrbMeshes[i].visible = true;
    }
    syncColossusOrbWorldPositions();

    audio.colossusRoar();
    player.addShake(0.45);
    fovKick = Math.min(10.5, fovKick + 4.2);
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(colossusPos.clone().setY(colossusPos.y + 4.0), 0xff5420, 120, 26, 0.48);
    }
    G.hud.warn('巨型荒神降临 · 击碎背轮四雷鼓破势！', 3.4);
    G.hud.feed('<b>荒神大天狗 · 八岐鬼王丸</b><em>巨型首领讨伐开启</em>');
  }

  const _colHitPt = new THREE.Vector3();
  const _colHitNrm = new THREE.Vector3();
  const _colBestCenter = new THREE.Vector3();
  const _colTmpA = new THREE.Vector3();
  const _colTmpB = new THREE.Vector3();
  const _colTmpC = new THREE.Vector3();
  const COLOSSUS_BODY_SPHERES = [
    { yOff: 1.65, r: 1.55 },
    { yOff: 3.85, r: 1.85 },
    { yOff: 5.75, r: 1.25 },
  ];

  function raycastColossalBoss(
    origin: any,
    dir: any,
    maxDist: number
  ): { dist: number; point: any; normal: any; orbIndex: number } | null {
    if (!colossusState || colossusState.hp <= 0 || !colossusRoot.visible) return null;

    let bestDist = maxDist;
    let bestOrb = -2;
    let hasCenter = false;

    // 1. Test the 4 glowing Raijin Taiko weakspot orbs first (generous 0.78m hit radius!)
    for (let i = 0; i < 4; i++) {
      if (!colossusState.orbsAlive[i]) continue;
      const c = colossusOrbWorldPos[i];
      const ocx = origin.x - c.x;
      const ocy = origin.y - c.y;
      const ocz = origin.z - c.z;
      const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
      const cVal = ocx * ocx + ocy * ocy + ocz * ocz - 0.78 * 0.78;
      const disc = b * b - cVal;
      if (disc >= 0) {
        const t = -b - Math.sqrt(disc);
        if (t >= 0 && t < bestDist) {
          bestDist = t;
          bestOrb = i;
          _colBestCenter.copy(c);
          hasCenter = true;
        }
      }
    }
    if (bestOrb >= 0 && hasCenter) {
      _colHitPt.copy(origin).addScaledVector(dir, bestDist);
      _colHitNrm.copy(_colHitPt).sub(_colBestCenter).normalize();
      return { dist: bestDist, point: _colHitPt, normal: _colHitNrm, orbIndex: bestOrb };
    }

    // 2. Test stacked vertical body spheres (`legs y+1.6`, `cuirass y+3.8`, `head y+5.8`)
    for (const bs of COLOSSUS_BODY_SPHERES) {
      const cx = colossusPos.x;
      const cy = colossusPos.y + bs.yOff - (colossusState.stunTimer > 0 ? 1.05 : 0);
      const cz = colossusPos.z;
      const ocx = origin.x - cx;
      const ocy = origin.y - cy;
      const ocz = origin.z - cz;
      const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
      const cVal = ocx * ocx + ocy * ocy + ocz * ocz - bs.r * bs.r;
      const disc = b * b - cVal;
      if (disc >= 0) {
        const t = -b - Math.sqrt(disc);
        if (t >= 0 && t < bestDist) {
          bestDist = t;
          bestOrb = -1;
          _colBestCenter.set(cx, cy, cz);
          hasCenter = true;
        }
      }
    }

    if (bestOrb === -1 && hasCenter) {
      _colHitPt.copy(origin).addScaledVector(dir, bestDist);
      _colHitNrm.copy(_colHitPt).sub(_colBestCenter).normalize();
      return { dist: bestDist, point: _colHitPt, normal: _colHitNrm, orbIndex: -1 };
    }
    return null;
  }

  function applyColossusOutcome(outcome: ReturnType<typeof stepColossalBossDamage>, hitPoint: any, source: string) {
    colossusHitFlashT = 0.11;
    if (G.combat && G.combat.stats) {
      G.combat.stats.shots++;
      G.combat.stats.hits++;
    }
    if (outcome.totalDamage > 0) {
      if (activeHero === 'genji') {
        cdState.ultCharge = addUltimateDamageCharge(
          cdState.ultCharge,
          outcome.totalDamage * 0.85,
          buildStats.ultChargeMultiplier,
          cdState.dragonActiveT > 0
        );
      }
      if (
        buildStats.dragonbladeLifestealRatio > 0 &&
        (source === 'dragonblade' || source === 'dragon-wave')
      ) {
        player.heal(outcome.totalDamage * buildStats.dragonbladeLifestealRatio);
      }
    }
    if (G.hud && G.hud.hitmarker) {
      G.hud.hitmarker(outcome.killed, outcome.orbShattered);
    }

    if (outcome.orbShattered && outcome.shatteredOrbIndex >= 0) {
      const idx = outcome.shatteredOrbIndex;
      if (colOrbMeshes[idx]) colOrbMeshes[idx].visible = false;
      audio.orbShatter();
      genjiWeapon.spawnParryBurst(hitPoint, true);
      combatVfx.triggerImpact({
        point: hitPoint,
        dir: player.forward,
        weak: true,
        killed: false,
        heavy: true,
        colorHex: 0xffe066,
      });
      colTelegraphMesh.visible = false;
      // Shattering a Raijin orb resets mobility & grants +18% ultimate charge!
      cdState.swiftCd = 0;
      hanzoCd.lungeCd = 0;
      hanzoCd.sonicCd = 0;
      gunnerCd.helixCd = 0;
      swiftResetFlashT = 0.85;
      audio.swiftReset();
      cdState.ultCharge = clamp(cdState.ultCharge + 18, 0, 100);
      gunnerCd.ultCharge = clamp(gunnerCd.ultCharge + 18, 0, 100);
      hanzoCd.ultCharge = clamp(hanzoCd.ultCharge + 18, 0, 100);
      applyHeavyHitstop(0.055, 3.8);
      player.addShake(0.32);
      G.hud.warn('雷鼓击碎 · 巨型荒神破势眩晕！技能已重置！', 2.4);
      G.hud.feed('<b>击碎荒神雷鼓弱点</b><em>造成 12% 最大生命崩解伤害 · 技能刷新</em>');
    } else if (outcome.phaseChanged && !outcome.killed) {
      audio.colossusRoar();
      player.addShake(0.36);
      G.hud.warn(
        outcome.newPhase === 3
          ? '荒神狂暴 · 叁之狂【业火大太刀】！'
          : '荒神怒吼 · 贰之怒【雷神连弹】！',
        2.5
      );
    }

    if (outcome.killed) {
      colossusDeathT = 1.35;
      colTelegraphMesh.visible = false;
      audio.colossusRoar();
      audio.orbShatter();
      player.heal(80);
      cdState.swiftCd = 0;
      hanzoCd.lungeCd = 0;
      gunnerCd.helixCd = 0;
      swiftResetFlashT = 0.95;
      cdState.ultCharge = clamp(cdState.ultCharge + 45, 0, 100);
      gunnerCd.ultCharge = clamp(gunnerCd.ultCharge + 45, 0, 100);
      hanzoCd.ultCharge = clamp(hanzoCd.ultCharge + 45, 0, 100);
      pendingDraftCount++;
      pendingGuaranteedRare = true;
      runStats.kills += 5;
      applyHeavyHitstop(0.065, 5.2);
      player.addShake(0.5);
      _colTmpA.set(colossusPos.x, colossusPos.y + 3.5, colossusPos.z);
      combatVfx.triggerImpact({
        point: _colTmpA,
        dir: player.forward,
        weak: true,
        killed: true,
        heavy: true,
        colorHex: 0xffcc55,
      });
      if (G.render && G.render.lightPool) {
        G.render.lightPool.flash(_colTmpA, 0xffcc55, 130, 28, 0.55);
      }
      G.hud.warn('巨型荒神讨伐成功 · 获赐奥义秘传！', 3.4);
      G.hud.feed('<b>已讨伐 · 荒神大天狗 八岐鬼王丸</b><em>全伤调息 · 奥义赐福</em>');
    }
  }

  function damageColossalBoss(
    amount: number,
    point: any,
    _dir: any,
    orbIndex: number,
    source: string
  ): { killed: boolean; orbShattered: boolean } {
    if (!colossusState || colossusState.hp <= 0) return { killed: false, orbShattered: false };
    const outcome = stepColossalBossDamage(colossusState, amount, orbIndex);
    applyColossusOutcome(outcome, point, source);
    return { killed: outcome.killed, orbShattered: outcome.orbShattered };
  }

  function cleaveColossalBoss(
    center: any,
    radius: number,
    amount: number,
    _dir: any,
    source: string
  ): { hit: boolean; killed: boolean; orbShattered: boolean } {
    if (!colossusState || colossusState.hp <= 0 || !colossusRoot.visible) {
      return { hit: false, killed: false, orbShattered: false };
    }
    // Check if cleave sphere reaches any alive Raijin weakspot orb first!
    for (let i = 0; i < 4; i++) {
      if (!colossusState.orbsAlive[i]) continue;
      if (colossusOrbWorldPos[i].distanceTo(center) <= radius + 0.95) {
        const outcome = stepColossalBossDamage(colossusState, amount, i);
        applyColossusOutcome(outcome, colossusOrbWorldPos[i], source);
        return { hit: true, killed: outcome.killed, orbShattered: outcome.orbShattered };
      }
    }
    const horiz = Math.hypot(center.x - colossusPos.x, center.z - colossusPos.z);
    const inY = center.y >= colossusPos.y - 1.2 && center.y <= colossusPos.y + 7.4;
    if (horiz <= radius + 2.15 && inY) {
      _colTmpA.set(colossusPos.x, clamp(center.y, colossusPos.y + 1.4, colossusPos.y + 5.2), colossusPos.z);
      const outcome = stepColossalBossDamage(colossusState, amount, -1);
      applyColossusOutcome(outcome, _colTmpA, source);
      return { hit: true, killed: outcome.killed, orbShattered: false };
    }
    return { hit: false, killed: false, orbShattered: false };
  }

  function spawnBossFlameArc(origin: any, dir: any, tiltRad: number) {
    let slot: BossFlameArc | null = null;
    for (const a of bossFlameArcs) {
      if (!a.active) {
        slot = a;
        break;
      }
    }
    if (!slot) slot = bossFlameArcs[0];
    slot.active = true;
    slot.pos.copy(origin);
    slot.dir.copy(dir).normalize();
    slot.life = 1.65;
    slot.mesh.visible = true;
    slot.mesh.position.copy(origin);
    _colTmpC.copy(origin).add(slot.dir);
    slot.mesh.lookAt(_colTmpC);
    slot.mesh.rotateZ(tiltRad);
  }

  function updateColossalBoss(dt: number) {
    // Step Boss Flame Crescent projectiles
    for (const arc of bossFlameArcs) {
      if (!arc.active) continue;
      arc.life -= dt;
      if (arc.life <= 0) {
        arc.active = false;
        arc.mesh.visible = false;
        continue;
      }
      arc.pos.addScaledVector(arc.dir, 28 * dt);
      arc.mesh.position.copy(arc.pos);
      if (player.alive && arc.pos.distanceTo(player.eye) < 2.25) {
        player.damage(26, arc.pos);
        arc.active = false;
        arc.mesh.visible = false;
      }
    }

    // Step Expanding Ground-Slam Shockwave Ring
    if (colossusShockwaveT > 0) {
      colossusShockwaveT = Math.max(0, colossusShockwaveT - dt * 1.15);
      const prog = 1 - colossusShockwaveT;
      const maxR = 19.5;
      colShockwaveMesh.visible = true;
      colShockwaveMesh.position.set(colossusShockwaveOrigin.x, colossusShockwaveOrigin.y + 0.08, colossusShockwaveOrigin.z);
      colShockwaveMesh.scale.set(maxR * 2, maxR * 2, 1);
      colShockwaveMat.uniforms.uProgress.value = prog;

      if (!colossusShockwaveHitPlayer && player.alive) {
        const ringRadius = prog * maxR;
        const pHoriz = Math.hypot(player.pos.x - colossusShockwaveOrigin.x, player.pos.z - colossusShockwaveOrigin.z);
        const pHeightAboveSlam = player.pos.y - colossusShockwaveOrigin.y;
        // Jumping (`Space` double-jump) or climbing above +1.35m cleanly clears the ground shockwave!
        if (Math.abs(pHoriz - ringRadius) < 1.35 && Math.abs(pHeightAboveSlam) < 1.35) {
          colossusShockwaveHitPlayer = true;
          player.damage(30, colossusShockwaveOrigin);
        }
      }
      if (colossusShockwaveT <= 0) {
        colShockwaveMesh.visible = false;
      }
    }

    // Death collapse dissolve animation
    if (colossusDeathT > 0) {
      colossusDeathT = Math.max(0, colossusDeathT - dt);
      const k = 1 - colossusDeathT / 1.35;
      colossusBody.position.y = -k * 2.4;
      colossusBody.rotation.x = k * 0.65;
      colossusRoot.scale.setScalar(Math.max(0.01, 1 - k * 0.45));
      if (colossusDeathT <= 0) {
        colossusRoot.visible = false;
        colossusBody.position.set(0, 0, 0);
        colossusBody.rotation.set(0, 0, 0);
        colossusState = null;
      }
      return;
    }

    if (!colossusState || colossusState.hp <= 0) return;

    colossusAnimTime += dt;
    colossusHitFlashT = Math.max(0, colossusHitFlashT - dt);
    matColossusCrimson.emissive.setRGB(
      colossusHitFlashT > 0 ? 0.85 : colossusState.phase === 3 ? 0.22 : 0.05,
      colossusHitFlashT > 0 ? 0.35 : 0.02,
      0.01
    );

    // Rotate Raijin back-halo wheel & pulse alive weakspot orbs
    const wheelSpeed = colossusState.stunTimer > 0 ? 0.25 : 0.75 + colossusState.phase * 0.32;
    colRaijinWheel.rotation.z = Math.sin(colossusAnimTime * wheelSpeed) * 0.28;
    for (let i = 0; i < 4; i++) {
      if (colossusState.orbsAlive[i]) {
        const pulse = 1 + 0.10 * Math.sin(colossusAnimTime * 5.2 + i * 1.6);
        colOrbMeshes[i].scale.setScalar(pulse);
      }
    }

    // Staggered / Kneeling Stun State (`破势眩晕`)
    if (colossusState.stunTimer > 0) {
      colossusState.stunTimer = Math.max(0, colossusState.stunTimer - dt);
      colossusBody.position.y = damp(colossusBody.position.y, -1.08, 10, dt);
      colChest.rotation.x = damp(colChest.rotation.x, 0.32, 10, dt);
      colSwordArm.rotation.x = damp(colSwordArm.rotation.x, 0.45, 8, dt);
      syncColossusOrbWorldPositions();
      return;
    }

    colossusBody.position.y = damp(colossusBody.position.y, 0, 8, dt);
    colChest.rotation.x = damp(colChest.rotation.x, 0, 8, dt);

    const dx = player.pos.x - colossusPos.x;
    const dz = player.pos.z - colossusPos.z;
    const horizDist = Math.hypot(dx, dz) || 1;
    const dy = player.pos.y - colossusPos.y;
    const desiredYaw = Math.atan2(dx, dz);
    let yawDiff = desiredYaw - colossusYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    colossusYaw += yawDiff * Math.min(1, dt * 3.6);
    colossusRoot.rotation.y = colossusYaw;

    // Active Attack Execution
    if (colossusState.activeAttack) {
      colossusState.attackTimer -= dt;
      const atk = colossusState.activeAttack;

      if (atk === 'odachi_slam') {
        // 1.35s total: 0.88s overhead windup + ground rune ring telegraph -> slam at 0.47s remaining!
        const elapsed = 1.35 - colossusState.attackTimer;
        if (elapsed < 0.88) {
          const wProg = clamp01(elapsed / 0.88);
          colSwordArm.rotation.x = -2.35 * wProg;
          colSwordArm.rotation.z = -0.22 * wProg;
          colTelegraphMesh.visible = true;
          colTelegraphMesh.position.set(colossusPos.x, colossusPos.y + 0.06, colossusPos.z);
          colTelegraphMesh.scale.set(39, 39, 1);
          colTelegraphMat.uniforms.uProgress.value = wProg;
        } else {
          if (!colossusSlamFired) {
            colossusSlamFired = true;
            colTelegraphMesh.visible = false;
            colossusShockwaveOrigin.copy(colossusPos);
            colossusShockwaveT = 1.0;
            colossusShockwaveHitPlayer = false;
            audio.colossusSlam();
            player.addShake(0.44);
            if (G.level && typeof G.level.damageInRadius === 'function') {
              G.level.damageInRadius(colossusPos, 7.5, 120, player.forward);
            }
            if (G.render && G.render.lightPool) {
              _colTmpA.set(colossusPos.x, colossusPos.y + 1.2, colossusPos.z);
              G.render.lightPool.flash(_colTmpA, 0xff6224, 110, 24, 0.35);
            }
          }
          colSwordArm.rotation.x = damp(colSwordArm.rotation.x, 0.88, 18, dt);
        }
      } else if (atk === 'raijin_barrage') {
        // Fires 6 glowing Raijin thunder-fire bolts into `G.enemies.debug.bolts` — fully deflectable with `E`!
        colSwordArm.rotation.x = damp(colSwordArm.rotation.x, -0.85, 8, dt);
        if (!colossusSlamFired && colossusState.attackTimer <= 0.65) {
          colossusSlamFired = true;
          const fireCtx = G.enemies && G.enemies.debug ? G.enemies.debug.ctx : null;
          if (fireCtx && fireCtx.fireBolt && player.alive) {
            for (let bIdx = 0; bIdx < 6; bIdx++) {
              _colTmpA.copy(colossusOrbWorldPos[bIdx % 4]);
              const spreadYaw = (bIdx - 2.5) * 0.048;
              _colTmpB.copy(player.eye).sub(_colTmpA).normalize().applyAxisAngle(_yAxis, spreadYaw);
              fireCtx.fireBolt(_colTmpA, _colTmpB, activeBoss || { pos: colossusPos, alive: true });
              const bolts = G.enemies.debug.bolts;
              for (let k = bolts.length - 1; k >= 0; k--) {
                if (bolts[k].on && bolts[k].pos.distanceToSquared(_colTmpA) < 0.12) {
                  bolts[k].__colossus = true;
                  break;
                }
              }
            }
            if (G.render && G.render.lightPool) {
              _colTmpA.set(colossusPos.x, colossusPos.y + 5.0, colossusPos.z);
              G.render.lightPool.flash(_colTmpA, 0xffb838, 95, 20, 0.25);
            }
          }
        }
      } else if (atk === 'flame_crescents') {
        const elapsed = 1.15 - colossusState.attackTimer;
        colSwordArm.rotation.z = Math.sin(elapsed * 5.2) * 1.25;
        colSwordArm.rotation.x = -0.55;
        if (!colossusSlamFired && elapsed >= 0.48 && player.alive) {
          colossusSlamFired = true;
          _colTmpA.set(colossusPos.x, colossusPos.y + 3.3, colossusPos.z);
          _colTmpB.copy(player.eye).sub(_colTmpA).normalize();
          spawnBossFlameArc(_colTmpA, _colTmpB, 0.35);
          _colTmpB.applyAxisAngle(_yAxis, 0.11);
          spawnBossFlameArc(_colTmpA, _colTmpB, -0.35);
          audio.dragonSlash(true);
        }
      } else if (atk === 'terrace_leap') {
        const dur = 0.95;
        const u = clamp01(1 - colossusState.attackTimer / dur);
        colossusPos.lerpVectors(colossusLeapStart, colossusLeapEnd, u);
        colossusPos.y += Math.sin(u * Math.PI) * 9.5;
        colSwordArm.rotation.x = -2.1 * Math.sin(u * Math.PI);
        if (colossusState.attackTimer <= 0.02 && !colossusSlamFired) {
          colossusSlamFired = true;
          colossusPos.copy(colossusLeapEnd);
          colossusShockwaveOrigin.copy(colossusPos);
          colossusShockwaveT = 1.0;
          colossusShockwaveHitPlayer = false;
          audio.colossusSlam();
          player.addShake(0.42);
        }
      }

      if (colossusState.attackTimer <= 0) {
        colossusState.activeAttack = null;
        colossusSlamFired = false;
        colTelegraphMesh.visible = false;
        colossusState.attackCooldown = Math.max(0.85, 2.05 - colossusState.phase * 0.32);
      }
    } else {
      // Heavy colossal bipedal stride with physiological knee flexion & weight-shift pelvic bob!
      matColossusFlame.uniforms.uTime.value = colossusAnimTime;
      colSwordArm.rotation.x = damp(colSwordArm.rotation.x, -0.25 + Math.sin(colossusAnimTime * 2.4) * 0.12, 6, dt);
      colSwordArm.rotation.z = damp(colSwordArm.rotation.z, 0, 6, dt);

      if (horizDist > 8.5) {
        const moveStep = (3.6 + colossusState.phase * 0.65) * dt;
        const nx = colossusPos.x + (dx / horizDist) * moveStep;
        const nz = colossusPos.z + (dz / horizDist) * moveStep;
        const gY = G.physics.groundHeight(nx, nz, colossusPos.y + 1.6);
        let moved = false;
        if (Number.isFinite(gY) && Math.abs(gY - colossusPos.y) <= 1.45) {
          colossusPos.set(nx, Math.max(0, gY), nz);
          moved = true;
        }
        const gaitPose = computeBipedalGaitPose(colossusAnimTime * 2.65, moved ? 0.85 : 0, 0.08);
        colLegL.rotation.x = -gaitPose.hipL;
        colLegR.rotation.x = -gaitPose.hipR;
        colKneeL.rotation.x = gaitPose.kneeL * 0.82;
        colKneeR.rotation.x = gaitPose.kneeR * 0.82;
        colossusBody.position.y = gaitPose.pelvisBob * 3.2;
        colChest.rotation.y = gaitPose.torsoTwist * 0.65;
      } else {
        colLegL.rotation.x = damp(colLegL.rotation.x, 0.06, 8, dt);
        colLegR.rotation.x = damp(colLegR.rotation.x, 0.06, 8, dt);
        colKneeL.rotation.x = damp(colKneeL.rotation.x, 0.10, 8, dt);
        colKneeR.rotation.x = damp(colKneeR.rotation.x, 0.10, 8, dt);
        colossusBody.position.y = damp(colossusBody.position.y, 0, 8, dt);
        colChest.rotation.y = damp(colChest.rotation.y, 0, 8, dt);
      }

      colossusState.attackCooldown -= dt;
      if (colossusState.attackCooldown <= 0 && player.alive) {
        colossusSlamFired = false;
        colossusState.attackIndex++;
        if (Math.abs(dy) > 2.8 || horizDist > 29) {
          colossusState.activeAttack = 'terrace_leap';
          colossusState.attackTimer = 0.95;
          colossusLeapStart.copy(colossusPos);
          const landX = clamp(player.pos.x - (dx / horizDist) * 9.5, -66, 70);
          const landZ = clamp(player.pos.z - (dz / horizDist) * 9.5, -42, 42);
          const landY = G.physics.groundHeight(landX, landZ, player.pos.y + 4.5);
          colossusLeapEnd.set(landX, Number.isFinite(landY) ? Math.max(0, landY) : player.pos.y, landZ);
          audio.colossusRoar();
        } else {
          const cycle = colossusState.attackIndex % 3;
          if (cycle === 0) {
            colossusState.activeAttack = 'odachi_slam';
            colossusState.attackTimer = 1.35;
          } else if (cycle === 1) {
            colossusState.activeAttack = 'raijin_barrage';
            colossusState.attackTimer = 1.15;
          } else {
            colossusState.activeAttack = 'flame_crescents';
            colossusState.attackTimer = 1.15;
          }
        }
      }
    }

    colossusRoot.position.copy(colossusPos);
    syncColossusOrbWorldPositions();
  }

  // Listen for kills on `G.events`
  G.events.on('enemy:killed', (payload: any) => {
    const en = payload && payload.enemy ? payload.enemy : null;
    if (en && en.__laserMesh) en.__laserMesh.visible = false;
    handleEnemyEliminated(en);
    runStats.kills++;
    const feedLabel =
      en && en.__variant === 'boss'
        ? '赤备重甲统领'
        : en && en.__variant === 'spider_mech'
          ? '四足重装机关蜘蛛'
          : en && en.__variant === 'shield_guard'
            ? '玄甲盾卫机关兵'
            : en && en.__variant === 'mortar_crab'
              ? '六足轰击机关蟹'
              : en && en.__variant === 'sniper'
                ? '屋脊铁炮狙击手'
                : en && en.__variant === 'swarm'
                  ? '迅捷木鸢'
                  : en && en.type === 'trooper'
                    ? '铁炮足轻'
                    : en && en.type === 'hound'
                      ? '忍犬机关'
                      : '木鸢机关';
    const resetSub =
      activeHero === 'gunner'
        ? '飞弹冷却缩减'
        : activeHero === 'hanzo'
          ? '音矢/跃步冷却缩减'
          : '影 已重置';
    G.hud.feed(`<b>已淘汰 · ${feedLabel}</b><em>${resetSub}</em>`);
  });

  // =========================================================================
  // SLEEK CHAMFERED HUD EXTENSION, PARRY FLARE, TACTICAL VISOR & DRAFT MODAL
  // =========================================================================
  const uiRoot = document.getElementById('ui')!;
  const hudRoot = G.hud.root as HTMLElement;

  const genjiHudEl = document.createElement('div');
  genjiHudEl.className = 'g-hud';
  genjiHudEl.innerHTML = `
    <div class="g-tracker-layer" aria-hidden="true"></div>

    <div class="g-visor-hud" hidden aria-hidden="true">
      <div class="g-visor-ring"></div>
      <div class="g-visor-lock" hidden><i></i><span>目标锁定</span></div>
    </div>

    <div class="g-bow-hud" hidden aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <circle class="g-bow-bg" cx="32" cy="32" r="24"></circle>
        <circle class="g-bow-arc" cx="32" cy="32" r="24" stroke-dasharray="150.8" stroke-dashoffset="150.8"></circle>
      </svg>
      <span class="g-bow-tag" hidden></span>
    </div>

    <div class="g-parry-flare" hidden aria-hidden="true">
      <svg viewBox="0 0 36 14"><path d="M2 12L18 3L34 12" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>
      <b class="g-parry-txt">招架反击 ×1</b>
    </div>

    <div class="g-colossus" hidden>
      <div class="g-col-head">
        <div class="g-col-title-wrap">
          <span class="g-col-phase">壹之型</span>
          <b class="g-col-name">荒神大天狗 · 八岐鬼王丸</b>
        </div>
        <span class="g-col-hp">1550 / 1550</span>
      </div>
      <div class="g-col-bar">
        <i class="g-col-ghost"></i>
        <i class="g-col-fill"></i>
      </div>
      <div class="g-col-sub">
        <span>背轮雷鼓弱点（击碎破势眩晕）</span>
        <span class="g-col-orbs">
          <i class="g-orb-pip" data-orb="0"></i>
          <i class="g-orb-pip" data-orb="1"></i>
          <i class="g-orb-pip" data-orb="2"></i>
          <i class="g-orb-pip" data-orb="3"></i>
        </span>
      </div>
    </div>

    <div class="g-top-actions">
      <div class="g-hero-badge" aria-label="当前出战英雄">
        <b class="g-hs-name">岛田源氏 · 龙刃</b>
      </div>
      <button type="button" class="g-bell-cta" aria-label="敲响荒神讨伐钟 召唤巨型首领">
        <span>讨伐荒神</span>
        <kbd>B</kbd>
      </button>
    </div>

    <div class="g-boss" hidden>
      <div class="g-boss-top"><span class="g-boss-k">山城首领</span><b class="g-boss-name">赤备重甲统领 · 鬼丸</b><span class="g-boss-hp">100%</span></div>
      <div class="g-boss-bar"><i class="g-boss-fill"></i></div>
    </div>

    <div class="g-ult" role="button" tabindex="0" aria-label="释放终极技能">
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle class="g-ult-bg" cx="44" cy="44" r="37"></circle>
        <circle class="g-ult-fg" cx="44" cy="44" r="37" stroke-dasharray="232.48" stroke-dashoffset="232.48"></circle>
      </svg>
      <div class="g-ult-inner">
        <b class="g-ult-pct">25%</b>
        <span class="g-ult-lbl">斩 · 龙刃</span>
      </div>
      <kbd class="g-ult-key">Q</kbd>
    </div>

    <div class="g-abilities" aria-label="英雄技能栏">
      <div class="g-slot" data-slot="climb">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19l5-5 5 5M7 12l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <b class="g-scd"></b>
        <span class="g-sname" data-slot-lbl="climb">灵</span>
        <kbd data-slot-key="climb">Space</kbd>
      </div>
      <div class="g-slot" data-slot="swift">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17L19 5M11 5h8v8M3 20l8-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <b class="g-scd"></b>
        <span class="g-sname" data-slot-lbl="swift">影</span>
        <kbd data-slot-key="swift">Shift</kbd>
      </div>
      <div class="g-slot" data-slot="deflect">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5M15 5h4v4M6 9l9 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <b class="g-scd"></b>
        <span class="g-sname" data-slot-lbl="deflect">闪</span>
        <kbd data-slot-key="deflect">E</kbd>
      </div>
      <div class="g-slot" data-slot="melee">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M14 6h4v4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        <span class="g-sname" data-slot-lbl="melee">速斩</span>
        <kbd data-slot-key="melee">V</kbd>
      </div>
    </div>

    <div class="g-build-strip" aria-label="已装备战术强化"></div>
  `;
  hudRoot.appendChild(genjiHudEl);

  // Pre-allocate 8 zero-GC 3D-to-2D Enemy Spirit-Sense Marker nodes inside `.g-tracker-layer`
  const trackerLayerEl = genjiHudEl.querySelector('.g-tracker-layer') as HTMLElement;
  interface TrackerDomSlot {
    root: HTMLElement;
    distEl: HTMLElement;
    elevEl: HTMLElement;
  }
  const trackerSlots: TrackerDomSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('div');
    el.className = 'g-trk';
    el.hidden = true;
    el.innerHTML = `
      <div class="g-trk-pin"><i class="g-trk-diamond"></i></div>
      <div class="g-trk-tag"><span class="g-trk-dist">20m</span><span class="g-trk-elev"></span></div>
    `;
    trackerLayerEl.appendChild(el);
    trackerSlots.push({
      root: el,
      distEl: el.querySelector('.g-trk-dist') as HTMLElement,
      elevEl: el.querySelector('.g-trk-elev') as HTMLElement,
    });
  }

  const heroBadgeEl = genjiHudEl.querySelector('.g-hero-badge') as HTMLElement;
  const heroSwitchNameEl = genjiHudEl.querySelector('.g-hs-name') as HTMLElement;
  const parryFlareEl = genjiHudEl.querySelector('.g-parry-flare') as HTMLElement;
  const parryTxtEl = genjiHudEl.querySelector('.g-parry-txt') as HTMLElement;
  const visorHudEl = genjiHudEl.querySelector('.g-visor-hud') as HTMLElement;
  const visorLockEl = genjiHudEl.querySelector('.g-visor-lock') as HTMLElement;
  const visorLockTxtEl = visorLockEl.querySelector('span') as HTMLElement;
  const bowHudEl = genjiHudEl.querySelector('.g-bow-hud') as HTMLElement;
  const bowArcEl = genjiHudEl.querySelector('.g-bow-arc') as SVGCircleElement;
  const bowTagEl = genjiHudEl.querySelector('.g-bow-tag') as HTMLElement;

  const colossusHudEl = genjiHudEl.querySelector('.g-colossus') as HTMLElement;
  const colossusPhaseEl = genjiHudEl.querySelector('.g-col-phase') as HTMLElement;
  const colossusHpEl = genjiHudEl.querySelector('.g-col-hp') as HTMLElement;
  const colossusFillEl = genjiHudEl.querySelector('.g-col-fill') as HTMLElement;
  const colossusGhostEl = genjiHudEl.querySelector('.g-col-ghost') as HTMLElement;
  const colossusOrbPips = Array.from(genjiHudEl.querySelectorAll('.g-orb-pip')) as HTMLElement[];
  const bossBellBtn = genjiHudEl.querySelector('.g-bell-cta') as HTMLButtonElement;
  bossBellBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    bossBellBtn.blur();
    audio.resume();
    if (gameApi.state === 'playing' || gameApi.state === 'intro') {
      spawnColossalBoss(Math.max(1, runStats.wave), true);
    }
  });

  // 3-Choice Tactical Roguelike Draft Overlay
  const upgradeModal = document.createElement('section');
  upgradeModal.className = 'g-draft';
  upgradeModal.setAttribute('role', 'dialog');
  upgradeModal.setAttribute('aria-modal', 'true');
  upgradeModal.setAttribute('aria-label', '战术潜能强化选择');
  upgradeModal.hidden = true;
  upgradeModal.innerHTML = `
    <div class="g-draft-veil"></div>
    <div class="g-draft-box">
      <header class="g-draft-head">
        <div class="g-draft-k" data-draft-sub>波次肃清 · 护甲已恢复</div>
        <h2 class="g-draft-title">守望潜能 · 三选一</h2>
        <p class="g-draft-hint">点击战术模块（或按 <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>）强化本局专属潜能并迎战下一波</p>
      </header>
      <div class="g-draft-grid" data-draft-grid></div>
    </div>
  `;
  uiRoot.appendChild(upgradeModal);

  const bossWrap = genjiHudEl.querySelector('.g-boss') as HTMLElement;
  const bossFill = genjiHudEl.querySelector('.g-boss-fill') as HTMLElement;
  const bossHpTxt = genjiHudEl.querySelector('.g-boss-hp') as HTMLElement;
  const ultWrap = genjiHudEl.querySelector('.g-ult') as HTMLElement;
  ultWrap.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    audio.resume();
    if (activeHero === 'gunner') {
      tryCastTacticalVisor();
    } else if (activeHero === 'hanzo') {
      tryCastDragonstrike();
    } else if (cdState.ultCharge >= 100 && cdState.dragonActiveT <= 0) {
      tryCastDragonblade();
    }
  });
  const ultCircle = genjiHudEl.querySelector('.g-ult-fg') as SVGCircleElement;
  const ultPctTxt = genjiHudEl.querySelector('.g-ult-pct') as HTMLElement;
  const ultLblTxt = genjiHudEl.querySelector('.g-ult-lbl') as HTMLElement;
  const slotClimb = genjiHudEl.querySelector('[data-slot="climb"]') as HTMLElement;
  const slotClimbCd = slotClimb.querySelector('.g-scd') as HTMLElement;
  const slotClimbLbl = genjiHudEl.querySelector('[data-slot-lbl="climb"]') as HTMLElement;
  const slotClimbKey = genjiHudEl.querySelector('[data-slot-key="climb"]') as HTMLElement;
  const slotSwift = genjiHudEl.querySelector('[data-slot="swift"]') as HTMLElement;
  const slotSwiftCd = slotSwift.querySelector('.g-scd') as HTMLElement;
  const slotSwiftLbl = genjiHudEl.querySelector('[data-slot-lbl="swift"]') as HTMLElement;
  const slotDeflect = genjiHudEl.querySelector('[data-slot="deflect"]') as HTMLElement;
  const slotDeflectCd = slotDeflect.querySelector('.g-scd') as HTMLElement;
  const slotDeflectLbl = genjiHudEl.querySelector('[data-slot-lbl="deflect"]') as HTMLElement;
  const slotMeleeLbl = genjiHudEl.querySelector('[data-slot-lbl="melee"]') as HTMLElement;
  const buildStripEl = genjiHudEl.querySelector('.g-build-strip') as HTMLElement;
  const draftGridEl = upgradeModal.querySelector('[data-draft-grid]') as HTMLElement;
  const draftSubEl = upgradeModal.querySelector('[data-draft-sub]') as HTMLElement;

  const nativeHealthEl = hudRoot.querySelector('.h-health') as HTMLElement | null;
  const nativeWeaponNameEl = hudRoot.querySelector('.h-wname') as HTMLElement | null;
  const nativeAmmoReserveEl = hudRoot.querySelector('.h-ammo-r') as HTMLElement | null;

  let upgradeOpen = false;
  let pendingDraftCount = 0;
  let pendingGuaranteedRare = false;
  let currentChoices: GenjiUpgradeCard[] = [];

  function renderBuildStrip() {
    const entries = Object.entries(upgradeStacks).filter(([, c]) => c > 0);
    if (!entries.length) {
      buildStripEl.innerHTML = '';
      return;
    }
    buildStripEl.innerHTML = entries
      .map(([id, count]) => {
        const rawMeta = catalogMap.get(id);
        const meta = rawMeta ? resolveUpgradeCardForHero(rawMeta, activeHero) : undefined;
        const title = meta ? meta.title : id;
        const arch = meta ? meta.archetype : 'mobility';
        return `<span class="g-chip" data-arch="${arch}">${title}${count > 1 ? ` ×${count}` : ''}</span>`;
      })
      .join('');
  }

  function openUpgradeDraft(subtitle: string, guaranteedRare = false) {
    currentChoices = draftUpgradeChoices(upgradeStacks, rng, guaranteedRare, activeHero);
    if (!currentChoices.length) {
      beginNextWave();
      return;
    }

    // Flush any lingering world projectiles when wave clears so zero shurikens/spears/bolts freeze behind the scroll modal!
    flushWorldProjectiles();

    upgradeOpen = true;
    upgradeModal.hidden = false;
    menus.locationCard(false);
    draftSubEl.textContent = subtitle;
    document.body.dataset.state = 'upgrade';
    touchCtrl.setGameplayVisible(false);
    G.input.setGameplay && G.input.setGameplay(false);
    G.input.exitLock && G.input.exitLock();
    player.enabled = false;
    syncHeroWeaponVisibility();

    const archLabels =
      activeHero === 'gunner'
        ? GUNNER_ARCHETYPE_LABELS
        : activeHero === 'hanzo'
          ? HANZO_ARCHETYPE_LABELS
          : ARCHETYPE_LABELS;
    const actionLabel =
      activeHero === 'gunner'
        ? '装配此模块'
        : activeHero === 'hanzo'
          ? '研习此秘传'
          : '参悟此卷';

    draftGridEl.innerHTML = currentChoices
      .map((card, idx) => {
        const curLv = upgradeStacks[card.id] || 0;
        const archLabel = archLabels[card.archetype] || card.subtitle;
        const rarLabel = RARITY_LABELS[card.rarity] || '秘传';
        return `
          <button type="button" class="g-card" data-upgrade-idx="${idx}" data-arch="${card.archetype}" data-rarity="${card.rarity}">
            <div class="g-card-top">
              <span class="g-card-arch">${archLabel}</span>
              <span class="g-card-rar">${rarLabel} · ${curLv + 1}/${card.maxStacks}</span>
            </div>
            <h3 class="g-card-name">${card.title}</h3>
            <p class="g-card-desc">${card.description}</p>
            <div class="g-card-foot"><kbd>${idx + 1}</kbd><span>${actionLabel}</span></div>
          </button>
        `;
      })
      .join('');

    draftGridEl.querySelectorAll('button[data-upgrade-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number((btn as HTMLElement).dataset.upgradeIdx);
        chooseUpgrade(idx);
      });
    });
  }

  function chooseUpgrade(idx: number) {
    if (!upgradeOpen || idx < 0 || idx >= currentChoices.length) return;
    const picked = currentChoices[idx];
    upgradeStacks[picked.id] = (upgradeStacks[picked.id] || 0) + 1;
    totalUpgradesPicked++;

    const prevMaxHp = player.maxHealth;
    buildStats = computeGenjiBuildStats(upgradeStacks);
    gunnerStats = computeGunnerBuildStats(upgradeStacks);
    hanzoStats = computeHanzoBuildStats(upgradeStacks);
    player.maxHealth =
      activeHero === 'gunner'
        ? gunnerStats.maxHealth
        : activeHero === 'hanzo'
          ? hanzoStats.maxHealth
          : buildStats.maxHealth;
    if (player.maxHealth > prevMaxHp) {
      player.heal(player.maxHealth - prevMaxHp);
    }
    genjiWeapon.ammo = buildStats.magSize;
    gunnerWeapon.ammo = gunnerStats.magSize;
    hanzoLungeChargesLeft = hanzoStats.maxAirJumps;
    audio.upgradePick();
    renderBuildStrip();

    if (pendingDraftCount > 0) {
      pendingDraftCount--;
      openUpgradeDraft('烽火祠灵脉赐福 · 再解锁一项战术潜能', pendingGuaranteedRare);
      return;
    }

    upgradeOpen = false;
    upgradeModal.hidden = true;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.dataset.state = 'playing';
    player.enabled = true;
    syncHeroWeaponVisibility();
    G.input.setGameplay && G.input.setGameplay(true);
    touchCtrl.setGameplayVisible(true);
    if (!touchCtrl.active && !G.params?.shot && !G.params?.autostart) {
      G.input.requestLock && G.input.requestLock();
    }
    beginNextWave();
  }

  function syncHeroWeaponVisibility() {
    const effectiveState = upgradeOpen ? 'upgrade' : gameApi.state;
    const vis = computeHeroViewmodelVisibility(effectiveState, activeHero, !!G.params?.noweapon);
    G.weapon =
      activeHero === 'gunner'
        ? gunnerWeapon
        : activeHero === 'hanzo'
          ? hanzoWeapon
          : genjiWeapon;
    genjiWeapon.setVisible(vis.genjiVisible);
    gunnerWeapon.setVisible(vis.gunnerVisible);
    hanzoWeapon.setVisible(vis.hanzoVisible);
  }

  function setHeroClass(nextHero: HeroClassId, allowDuringReset = false): boolean {
    const effectiveState = upgradeOpen ? 'upgrade' : gameApi.state;
    if (!allowDuringReset && !canSwitchHeroInState(effectiveState)) {
      return false;
    }

    const prevHero = activeHero;
    activeHero = nextHero;
    document.body.dataset.hero = activeHero;
    touchCtrl.setHeroClass(activeHero);

    dashActiveT = 0;
    dragonLungeActiveT = 0;
    cdState.deflectActiveT = 0;
    agilityState.isWallClimbing = false;
    gunnerCd.sprintActive = false;
    hanzoCd.sonicArmed = false;
    hanzoCd.stormActiveT = 0;
    hanzoCd.stormArrowsLeft = 0;

    if (prevHero !== activeHero) {
      if (prevHero === 'genji') genjiWeapon.clearProjectiles();
      else if (prevHero === 'hanzo') hanzoWeapon.clearProjectiles();
      else gunnerWeapon.clearProjectiles();
    }

    syncHeroWeaponVisibility();
    if (activeHero === 'gunner') {
      gunnerWeapon.onEquip();
    } else if (activeHero === 'hanzo') {
      hanzoWeapon.onEquip();
    } else {
      genjiWeapon.onEquip();
    }

    if (player) {
      const hpRatio = player.maxHealth > 0 ? clamp01(player.health / player.maxHealth) : 1;
      player.maxHealth =
        activeHero === 'gunner'
          ? gunnerStats.maxHealth
          : activeHero === 'hanzo'
            ? hanzoStats.maxHealth
            : buildStats.maxHealth;
      player.health = Math.max(1, Math.round(player.maxHealth * hpRatio));
    }

    if (menus && menus.root) {
      (menus.root as HTMLElement).querySelectorAll<HTMLButtonElement>('button[data-hero-pick]').forEach((b) => {
        const on = b.dataset.heroPick === activeHero;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }

    renderBuildStrip();
    if (G.hud && typeof G.hud.update === 'function') {
      G.hud.update(0.016);
    }
    syncGenjiHud();
    return true;
  }

  function returnToHeroSelect() {
    upgradeOpen = false;
    upgradeModal.hidden = true;
    pendingDraftCount = 0;
    upgradeStacks = {};
    totalUpgradesPicked = 0;
    buildStats = createBaseGenjiStats();
    gunnerStats = createBaseGunnerStats();
    hanzoStats = createBaseHanzoStats();
    renderBuildStrip();
    clearVillageShrineEvent();
    flushWorldProjectiles();
    activeBoss = null;
    colossusState = null;
    colossusDeathT = 0;
    colossusShockwaveT = 0;
    colossusRoot.visible = false;
    colTelegraphMesh.visible = false;
    colShockwaveMesh.visible = false;
    for (const arc of bossFlameArcs) {
      arc.active = false;
      arc.mesh.visible = false;
    }
    G.enemies.clear();
    G.combat.reset();
    player.enabled = false;
    touchCtrl.setGameplayVisible(false);
    G.input.setGameplay && G.input.setGameplay(false);
    G.input.exitLock && G.input.exitLock();
    G.hud.show(false);
    menus.locationCard(false);
    G.audio && G.audio.setPaused && G.audio.setPaused(false);
    if (G.render && G.render.post) {
      G.render.post.fade = 0;
      G.render.post.saturation = 1;
    }
    setGameState('title');
    syncHeroWeaponVisibility();
    menus.show('title');
  }

  function restartWithHero(nextHero: HeroClassId, skipIntro = true) {
    setHeroClass(nextHero, true);
    runStats.retries++;
    startNewRun({ skipIntro, quick: true });
  }

  function syncGenjiHud() {
    if (nativeHealthEl) {
      nativeHealthEl.classList.add('on');
    }
    if (nativeAmmoReserveEl) {
      nativeAmmoReserveEl.textContent = '∞';
    }

    heroSwitchNameEl.textContent =
      activeHero === 'gunner'
        ? '神机统帅 · 枪兵'
        : activeHero === 'hanzo'
          ? '岛田半藏 · 岚弓'
          : '岛田源氏 · 龙刃';
    heroBadgeEl.hidden = upgradeOpen || (gameApi.state !== 'playing' && gameApi.state !== 'intro');

    // Center-reticle Parry Counter Flare (`招架反击 ×N`, clean & unobstructed!)
    if (activeHero === 'genji' && parryBannerT > 0) {
      parryFlareEl.hidden = false;
      parryTxtEl.textContent = `招架反击 ×${Math.max(1, parryStreakCount)}`;
    } else {
      parryFlareEl.hidden = true;
    }

    const circumference = 232.48;
    const bowArcLen = 150.8;

    if (activeHero === 'gunner') {
      bowHudEl.hidden = true;
      if (nativeWeaponNameEl) {
        nativeWeaponNameEl.textContent =
          gunnerCd.visorActiveT > 0 ? '战术目镜 · 智能锁定中' : '重型脉冲步枪 · 螺旋飞弹';
      }

      // Gunner Tactical Visor HUD Overlay
      const vState = gunnerWeapon.getVisorHudState();
      visorHudEl.hidden = !vState.active;
      if (vState.active && vState.locked) {
        visorLockEl.hidden = false;
        const vw = window.innerWidth || 1440;
        const vh = window.innerHeight || 900;
        visorLockEl.style.transform = `translate3d(${Math.round(vState.xNorm * vw)}px, ${Math.round(vState.yNorm * vh)}px, 0) translate(-50%, -50%)`;
        visorLockTxtEl.textContent = vState.targetName || '目标锁定';
      } else {
        visorLockEl.hidden = true;
      }

      // Gunner Ultimate (`Q · 战术目镜`)
      if (gunnerCd.visorActiveT > 0) {
        const ratio = clamp01(gunnerCd.visorActiveT / Math.max(1, gunnerCd.visorActiveT > gunnerCd.visorMaxT ? gunnerCd.visorActiveT : gunnerCd.visorMaxT));
        ultCircle.setAttribute('stroke-dashoffset', (circumference * (1 - ratio)).toFixed(1));
        ultPctTxt.textContent = `${gunnerCd.visorActiveT.toFixed(1)}s`;
        ultLblTxt.textContent = '目镜锁定';
        ultWrap.classList.add('active');
        ultWrap.classList.remove('ready');
      } else {
        const pct = Math.floor(gunnerCd.ultCharge);
        ultCircle.setAttribute('stroke-dashoffset', (circumference * (1 - pct / 100)).toFixed(1));
        ultPctTxt.textContent = `${pct}%`;
        ultLblTxt.textContent = pct >= 100 ? '开启目镜' : '战术目镜';
        ultWrap.classList.toggle('ready', pct >= 100);
        ultWrap.classList.remove('active');
      }

      // Gunner Ability Slots: [RMB 螺旋] [Shift 疾跑] [E 力场] [V 猛击]
      slotClimbLbl.textContent = '螺旋';
      slotClimbKey.textContent = '右键';
      const helixWait = gunnerCd.helixCd > 0.05;
      slotClimb.classList.toggle('cd', helixWait);
      slotClimb.classList.remove('active');
      slotClimbCd.textContent = helixWait ? gunnerCd.helixCd.toFixed(1) : '';

      slotSwiftLbl.textContent = '疾跑';
      slotSwift.classList.remove('cd');
      slotSwift.classList.toggle('active', gunnerCd.sprintActive);
      slotSwift.classList.toggle('reset-flash', swiftResetFlashT > 0);
      slotSwiftCd.textContent = '';

      slotDeflectLbl.textContent = '力场';
      const bioActive = gunnerCd.bioticActiveT > 0;
      const bioWait = !bioActive && gunnerCd.bioticCd > 0.05;
      slotDeflect.classList.toggle('active', bioActive);
      slotDeflect.classList.toggle('cd', bioWait);
      slotDeflectCd.textContent = bioActive
        ? gunnerCd.bioticActiveT.toFixed(1)
        : bioWait
          ? gunnerCd.bioticCd.toFixed(0)
          : '';

      slotMeleeLbl.textContent = '猛击';

      touchCtrl.syncGunnerHudState(
        gunnerCd,
        gunnerWeapon.ammo,
        gunnerWeapon.magSize
      );
    } else if (activeHero === 'hanzo') {
      visorHudEl.hidden = true;
      const bState = hanzoWeapon.getBowHudState();
      hanzoCd.drawRatio = bState.drawRatio;
      hanzoCd.sonicActiveT = bState.sonicActiveT;

      const showBowReticle =
        !upgradeOpen && (gameApi.state === 'playing' || gameApi.state === 'intro');
      bowHudEl.hidden = !showBowReticle;
      if (showBowReticle) {
        const ringRatio = clamp01(bState.drawRatio);
        bowArcEl.setAttribute('stroke-dashoffset', (bowArcLen * (1 - ringRatio)).toFixed(1));
        bowHudEl.classList.toggle('is-storm', bState.arrowMode === 'storm');
        bowHudEl.classList.toggle('is-sonic', bState.arrowMode === 'sonic');
        bowHudEl.classList.toggle('is-full', bState.isDrawing && ringRatio >= 0.96);
        if (bState.arrowMode === 'storm' && hanzoCd.stormArrowsLeft > 0) {
          bowTagEl.hidden = false;
          bowTagEl.textContent = `岚矢 ×${hanzoCd.stormArrowsLeft}`;
        } else if (bState.arrowMode === 'sonic') {
          bowTagEl.hidden = false;
          bowTagEl.textContent = '音障已搭箭';
        } else if (bState.sonicActiveT > 0.05) {
          bowTagEl.hidden = false;
          bowTagEl.textContent = `声呐透视 ${bState.sonicActiveT.toFixed(1)}s`;
        } else {
          bowTagEl.hidden = true;
        }
      }

      if (nativeWeaponNameEl) {
        nativeWeaponNameEl.textContent =
          hanzoCd.stormActiveT > 0 && hanzoCd.stormArrowsLeft > 0
            ? `风林岚弓 · 岚矢连射 (${hanzoCd.stormArrowsLeft})`
            : hanzoCd.sonicArmed
              ? '风林岚弓 · 音障探测矢'
              : '风林岚弓 · 蓄力神射';
      }

      // Hanzo Ultimate (`Q · 龙魂双生`)
      if (hanzoCd.dragonActiveT > 0) {
        const ratio = clamp01(hanzoCd.dragonActiveT / Math.max(1, hanzoStats.dragonstrikeDuration));
        ultCircle.setAttribute('stroke-dashoffset', (circumference * (1 - ratio)).toFixed(1));
        ultPctTxt.textContent = `${hanzoCd.dragonActiveT.toFixed(1)}s`;
        ultLblTxt.textContent = '双龙贯阵';
        ultWrap.classList.add('active');
        ultWrap.classList.remove('ready');
      } else {
        const pct = Math.floor(hanzoCd.ultCharge);
        ultCircle.setAttribute('stroke-dashoffset', (circumference * (1 - pct / 100)).toFixed(1));
        ultPctTxt.textContent = `${pct}%`;
        ultLblTxt.textContent = pct >= 100 ? '可召双龙' : '龙 · 双龙';
        ultWrap.classList.toggle('ready', pct >= 100);
        ultWrap.classList.remove('active');
      }

      // Hanzo Ability Slots: [Space 跃步] [Shift 音矢] [E 岚矢] [V 弓击]
      slotClimbLbl.textContent = '跃步';
      slotClimbKey.textContent = 'Space';
      const lungeWait = hanzoCd.lungeCd > 0.05 && !agilityState.isWallClimbing;
      slotClimb.classList.toggle('active', agilityState.isWallClimbing);
      slotClimb.classList.toggle('cd', lungeWait);
      slotClimbCd.textContent = lungeWait ? hanzoCd.lungeCd.toFixed(1) : '';

      slotSwiftLbl.textContent = '音矢';
      const sonicActive = hanzoCd.sonicArmed || hanzoCd.sonicActiveT > 0.05;
      const sonicWait = !sonicActive && hanzoCd.sonicCd > 0.05;
      slotSwift.classList.toggle('active', sonicActive);
      slotSwift.classList.toggle('cd', sonicWait);
      slotSwift.classList.toggle('reset-flash', swiftResetFlashT > 0);
      slotSwiftCd.textContent =
        hanzoCd.sonicActiveT > 0.05
          ? hanzoCd.sonicActiveT.toFixed(1)
          : sonicWait
            ? hanzoCd.sonicCd.toFixed(0)
            : '';

      slotDeflectLbl.textContent = '岚矢';
      const stormActive = hanzoCd.stormActiveT > 0 && hanzoCd.stormArrowsLeft > 0;
      const stormWait = !stormActive && hanzoCd.stormCd > 0.05;
      slotDeflect.classList.toggle('active', stormActive);
      slotDeflect.classList.toggle('cd', stormWait);
      slotDeflectCd.textContent = stormActive
        ? `×${hanzoCd.stormArrowsLeft}`
        : stormWait
          ? hanzoCd.stormCd.toFixed(0)
          : '';

      slotMeleeLbl.textContent = '弓击';

      touchCtrl.syncHanzoHudState(hanzoCd, agilityState.isWallClimbing);
    } else {
      visorHudEl.hidden = true;
      bowHudEl.hidden = true;
      if (nativeWeaponNameEl) {
        nativeWeaponNameEl.textContent =
          cdState.dragonActiveT > 0 ? '龙神之剑 · 拔刀连斩' : '风魔手里剑 · 龙丸佩刀';
      }

      // Genji Ultimate (`Q · 斩`) with explicit max-3 extension readout (`延斩 X/3`)
      if (cdState.dragonActiveT > 0) {
        const ratio = clamp01(cdState.dragonActiveT / Math.max(1, cdState.dragonMaxT));
        ultCircle.setAttribute('stroke-dashoffset', (circumference * (1 - ratio)).toFixed(1));
        ultPctTxt.textContent = `${cdState.dragonActiveT.toFixed(1)}s`;
        const usedExt = cdState.dragonExtendsUsed ?? 0;
        ultLblTxt.textContent = `延斩 ${usedExt}/${buildStats.maxDragonExtensions}`;
        ultWrap.classList.add('active');
        ultWrap.classList.remove('ready');
      } else {
        const pct = Math.floor(cdState.ultCharge);
        ultCircle.setAttribute('stroke-dashoffset', (circumference * (1 - pct / 100)).toFixed(1));
        ultPctTxt.textContent = `${pct}%`;
        ultLblTxt.textContent = pct >= 100 ? '可拔刀' : '斩 · 龙刃';
        ultWrap.classList.toggle('ready', pct >= 100);
        ultWrap.classList.remove('active');
      }

      slotClimbLbl.textContent = '灵';
      slotClimbKey.textContent = 'Space';
      slotClimb.classList.remove('cd');
      slotClimb.classList.toggle('active', agilityState.isWallClimbing);
      slotClimbCd.textContent = '';

      slotSwiftLbl.textContent = '影';
      const swiftOnCd = cdState.swiftCd > 0.05;
      slotSwift.classList.remove('active');
      slotSwift.classList.toggle('cd', swiftOnCd);
      slotSwift.classList.toggle('reset-flash', swiftResetFlashT > 0);
      slotSwiftCd.textContent = swiftOnCd ? cdState.swiftCd.toFixed(1) : '';

      slotDeflectLbl.textContent = '闪';
      const deflectActive = cdState.deflectActiveT > 0;
      const deflectWait = !deflectActive && cdState.deflectCd > 0.05;
      slotDeflect.classList.toggle('active', deflectActive);
      slotDeflect.classList.toggle('cd', deflectWait);
      slotDeflectCd.textContent = deflectActive
        ? cdState.deflectActiveT.toFixed(1)
        : deflectWait
          ? cdState.deflectCd.toFixed(1)
          : '';

      slotMeleeLbl.textContent = '速斩';

      touchCtrl.syncHudState(
        cdState,
        agilityState.isWallClimbing,
        swiftResetFlashT > 0,
        genjiWeapon.ammo,
        genjiWeapon.magSize
      );
    }

    // Colossal Giant Boss Banner & Summon Button
    const colossusAlive = !!(colossusState && colossusState.hp > 0);
    colossusHudEl.hidden = !colossusAlive;
    bossBellBtn.hidden = colossusAlive || upgradeOpen || (gameApi.state !== 'playing' && gameApi.state !== 'intro');
    if (colossusAlive && colossusState) {
      const cRatio = clamp01(colossusState.hp / Math.max(1, colossusState.maxHp));
      colossusFillEl.style.transform = `scaleX(${cRatio.toFixed(3)})`;
      colossusGhostEl.style.transform = `scaleX(${cRatio.toFixed(3)})`;
      colossusHpEl.textContent = `${Math.ceil(colossusState.hp)} / ${colossusState.maxHp}`;
      const stunned = colossusState.stunTimer > 0;
      colossusHudEl.classList.toggle('is-stunned', stunned);
      colossusPhaseEl.textContent = stunned
        ? `破势眩晕 ${colossusState.stunTimer.toFixed(1)}s`
        : colossusState.phase === 3
          ? '叁之狂'
          : colossusState.phase === 2
            ? '贰之怒'
            : '壹之型';
      for (let i = 0; i < 4; i++) {
        if (colossusOrbPips[i]) {
          colossusOrbPips[i].classList.toggle('shattered', !colossusState.orbsAlive[i]);
        }
      }
    }

    if (!colossusAlive && activeBoss && activeBoss.alive) {
      bossWrap.hidden = false;
      const ratio = clamp01(activeBoss.hp / Math.max(1, activeBoss.__maxHp || 820));
      bossFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
      bossHpTxt.textContent = `${Math.ceil(activeBoss.hp)} / ${activeBoss.__maxHp}`;
    } else {
      bossWrap.hidden = true;
    }

    updateEnemySpiritTracker();
  }

  const _projVec = new THREE.Vector3();
  let compassMarkerSyncT = 0;

  // Pre-allocated zero-GC candidate pool for `updateEnemySpiritTracker` (eliminates per-frame object allocations)
  interface TrackerCandidate {
    pos: any;
    headY: number;
    isBoss: boolean;
    inSonic: boolean;
    labelPrefix: string;
    distSq: number;
  }
  const MAX_TRACKER_CANDS = 40;
  const trackerCandPool: TrackerCandidate[] = [];
  for (let i = 0; i < MAX_TRACKER_CANDS; i++) {
    trackerCandPool.push({
      pos: null,
      headY: 0,
      isBoss: false,
      inSonic: false,
      labelPrefix: '',
      distSq: 0,
    });
  }
  const trackerCandSlice: TrackerCandidate[] = [];

  function updateEnemySpiritTracker() {
    if ((gameApi.state !== 'playing' && gameApi.state !== 'intro') || upgradeOpen || !player.alive) {
      for (const s of trackerSlots) s.root.hidden = true;
      return;
    }

    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;
    const halfW = vw * 0.5;
    const halfH = vh * 0.5;

    trackerCandSlice.length = 0;
    let candIdx = 0;

    if (colossusState && colossusState.hp > 0 && colossusRoot.visible && candIdx < MAX_TRACKER_CANDS) {
      const dx = colossusPos.x - player.pos.x;
      const dz = colossusPos.z - player.pos.z;
      const slot = trackerCandPool[candIdx++];
      slot.pos = colossusPos;
      slot.headY = colossusPos.y + 6.4;
      slot.isBoss = true;
      slot.inSonic = hanzoWeapon.isPointInSonicField(colossusPos);
      slot.labelPrefix = '荒神 ';
      slot.distSq = dx * dx + dz * dz;
      trackerCandSlice.push(slot);
    }

    const aliveList = G.enemies && G.enemies.list ? G.enemies.list : [];
    let totalAlive = 0;
    for (let i = 0; i < aliveList.length; i++) {
      const en = aliveList[i];
      if (!en.alive) continue;
      totalAlive++;
      if (candIdx >= MAX_TRACKER_CANDS) continue;
      const dx = en.pos.x - player.pos.x;
      const dz = en.pos.z - player.pos.z;
      const isMiniBoss = en.__variant === 'boss';
      const isSniper = en.__variant === 'sniper';
      const isSpider = en.__variant === 'spider_mech';
      const isShield = en.__variant === 'shield_guard';
      const isCrab = en.__variant === 'mortar_crab';
      const inSonic = hanzoWeapon.isPointInSonicField(en.pos);
      const slot = trackerCandPool[candIdx++];
      slot.pos = en.pos;
      slot.headY = en.pos.y + (isMiniBoss ? 2.75 : en.type === 'hound' ? 1.25 : 1.95);
      slot.isBoss = isMiniBoss;
      slot.inSonic = inSonic;
      slot.labelPrefix = inSonic
        ? '声呐 '
        : isMiniBoss
          ? '统领 '
          : isSniper
            ? '狙 '
            : isShield
              ? '盾 '
              : isSpider
                ? '蛛 '
                : isCrab
                  ? '蟹 '
                  : '';
      slot.distSq = dx * dx + dz * dz;
      trackerCandSlice.push(slot);
    }

    trackerCandSlice.sort((a, b) =>
      a.inSonic !== b.inSonic
        ? a.inSonic
          ? -1
          : 1
        : a.isBoss !== b.isBoss
          ? a.isBoss
            ? -1
            : 1
          : a.distSq - b.distSq
    );

    let used = 0;
    for (let i = 0; i < trackerCandSlice.length && used < trackerSlots.length; i++) {
      const c = trackerCandSlice[i];
      const info = computeEnemyLocatorInfo({
        playerX: player.pos.x,
        playerY: player.pos.y,
        playerZ: player.pos.z,
        forwardX: player.forward.x,
        forwardZ: player.forward.z,
        enemyX: c.pos.x,
        enemyY: c.pos.y,
        enemyZ: c.pos.z,
        isBoss: c.isBoss,
        isOccluded: true,
        remainingHostiles: totalAlive + spawnQueue.length,
      });
      if (!info.shouldShowMarker && !c.inSonic) continue;

      _projVec.set(c.pos.x, c.headY, c.pos.z).project(G.camera);
      const inFrontClip = _projVec.z >= -1 && _projVec.z <= 1 && !info.isBehind;
      let sx = (_projVec.x * 0.5 + 0.5) * vw;
      let sy = (-_projVec.y * 0.5 + 0.5) * vh;
      let isEdge = false;

      const padX = 64;
      const padTop = 78;
      const padBot = 112;
      if (!inFrontClip || sx < padX || sx > vw - padX || sy < padTop || sy > vh - padBot) {
        isEdge = true;
        // Map signed relative yaw onto a clean elliptical screen-edge guide!
        const ellRx = Math.max(120, halfW - 76);
        const ellRy = Math.max(90, halfH - 104);
        sx = halfW + Math.sin(info.relYawRad) * ellRx;
        const vertBias = clamp(-info.dy * 9 - (info.isBehind ? -ellRy * 0.55 : 0), -ellRy * 0.78, ellRy * 0.78);
        sy = clamp(halfH + vertBias, padTop, vh - padBot);
      }

      const slot = trackerSlots[used++];
      slot.root.hidden = false;
      slot.root.classList.toggle('is-boss', c.isBoss);
      slot.root.classList.toggle('is-sonic', c.inSonic);
      slot.root.classList.toggle('is-priority', info.urgency === 'priority');
      slot.root.classList.toggle('is-edge', isEdge);
      slot.root.style.transform = `translate3d(${Math.round(sx)}px, ${Math.round(sy)}px, 0) translate(-50%, -50%)`;
      slot.distEl.textContent = `${c.labelPrefix}${info.distMeters}m`;
      slot.elevEl.textContent = info.elevationLabel;
      slot.elevEl.classList.toggle('is-low', info.elevation === 'low');
    }

    for (let i = used; i < trackerSlots.length; i++) {
      trackerSlots[i].root.hidden = true;
    }

    // Sync only shrine objective to G.hud.setMarkers so native 3D yellow pins never duplicate `.g-trk`!
    compassMarkerSyncT -= 0.016;
    if (compassMarkerSyncT <= 0 && G.hud && typeof G.hud.setMarkers === 'function') {
      compassMarkerSyncT = 0.35;
      if (activeEventRelay) {
        G.hud.setMarkers([
          {
            id: 'village-shrine',
            short: '烽火祠',
            kind: 'relay',
            pos: activeEventRelay.interactPos || activeEventRelay.pos,
          },
        ]);
      } else {
        G.hud.setMarkers([]);
      }
    }
  }

  // =========================================================================
  // ENDLESS ROGUELIKE WAVE + VILLAGE BEACON SHRINE + MENU / FLOW CONTROLLER
  // =========================================================================
  const runStats = {
    time: 0,
    wave: 0,
    kills: 0,
    retries: 0,
  };

  let spawnQueue: GenjiEnemyVariant[] = [];
  let spawnTimer = 0;
  let currentWavePlan = computeWavePlan(1);
  let waveClearDelay = -1;
  let activeEventRelay: any = null;
  let relayCutProgress = 0;
  let stateTime = 0;
  let introTimer = 0;

  const menus = menuFactory(G, {
    selectHero(h: string) {
      if (h === 'genji' || h === 'hanzo' || h === 'gunner') {
        setHeroClass(h, false);
      }
    },
    deploy() {
      audio.resume();
      G.audio && G.audio.resume && G.audio.resume();
      if (touchCtrl.active) touchCtrl.requestLandscapeLock();
      else G.input.requestLock && G.input.requestLock();
      startNewRun({});
    },
    resume() {
      if (touchCtrl.active) touchCtrl.requestLandscapeLock();
      resumeFromPause(!touchCtrl.active);
    },
    'reselect-hero'() {
      audio.resume();
      returnToHeroSelect();
    },
    restart() {
      audio.resume();
      if (touchCtrl.active) touchCtrl.requestLandscapeLock();
      else G.input.requestLock && G.input.requestLock();
      runStats.retries++;
      startNewRun({ quick: true });
    },
    retry() {
      audio.resume();
      if (touchCtrl.active) touchCtrl.requestLandscapeLock();
      else G.input.requestLock && G.input.requestLock();
      runStats.retries++;
      startNewRun({ quick: true });
    },
    redeploy() {
      audio.resume();
      if (touchCtrl.active) touchCtrl.requestLandscapeLock();
      else G.input.requestLock && G.input.requestLock();
      startNewRun({ quick: true });
    },
  });
  menus.applySettings();
  currentDynamicFov = menus.settings ? menus.settings.fov : 75;

  // Add Touch Controls Preference, Touch Sensitivity & Mobile Aim Assist inside Settings Panel
  const settingsPane = menus.root.querySelector('[data-pane="settings"]');
  if (settingsPane) {
    const touchFrag = document.createDocumentFragment();

    const touchRow = document.createElement('div');
    touchRow.className = 'row';
    touchRow.innerHTML = `
      <label id="l-touch-pref">触屏操控界面</label>
      <div class="seg" role="group" aria-labelledby="l-touch-pref">
        <button type="button" data-tpref="auto">自动</button>
        <button type="button" data-tpref="on">开启</button>
        <button type="button" data-tpref="off">关闭</button>
      </div>
    `;

    const touchSensRow = document.createElement('div');
    touchSensRow.className = 'row';
    const initSensPct = Math.round(touchCtrl.touchSensitivity * 100);
    touchSensRow.innerHTML = `
      <label for="s-touch-sens">触屏转向灵敏度</label>
      <div class="slider">
        <input id="s-touch-sens" type="range" min="30" max="240" step="5" value="${initSensPct}">
        <output id="o-touch-sens">${(touchCtrl.touchSensitivity).toFixed(2)}×</output>
      </div>
    `;

    const touchAssistRow = document.createElement('div');
    touchAssistRow.className = 'row';
    touchAssistRow.innerHTML = `
      <label id="l-touch-assist">触屏辅助瞄准</label>
      <div class="seg" role="group" aria-labelledby="l-touch-assist">
        <button type="button" data-tassist="on">开启</button>
        <button type="button" data-tassist="off">关闭</button>
      </div>
    `;

    touchFrag.append(touchRow, touchSensRow, touchAssistRow);
    const firstNote = settingsPane.querySelector('.panel-note');
    if (firstNote) settingsPane.insertBefore(touchFrag, firstNote);
    else settingsPane.appendChild(touchFrag);

    const syncTouchSeg = () => {
      touchRow.querySelectorAll<HTMLButtonElement>('button[data-tpref]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.tpref === touchCtrl.preference));
      });
      touchAssistRow.querySelectorAll<HTMLButtonElement>('button[data-tassist]').forEach((b) => {
        const wantOn = b.dataset.tassist === 'on';
        b.setAttribute('aria-pressed', String(wantOn === touchCtrl.aimAssistEnabled));
      });
    };
    touchRow.querySelectorAll<HTMLButtonElement>('button[data-tpref]').forEach((b) => {
      b.addEventListener('click', () => {
        const pref = (b.dataset.tpref || 'auto') as TouchUiPreference;
        touchCtrl.setPreference(pref);
        syncTouchSeg();
      });
    });
    touchAssistRow.querySelectorAll<HTMLButtonElement>('button[data-tassist]').forEach((b) => {
      b.addEventListener('click', () => {
        touchCtrl.setAimAssistEnabled(b.dataset.tassist === 'on');
        syncTouchSeg();
      });
    });
    const tSensInput = touchSensRow.querySelector('#s-touch-sens') as HTMLInputElement | null;
    const tSensOut = touchSensRow.querySelector('#o-touch-sens') as HTMLElement | null;
    if (tSensInput) {
      tSensInput.addEventListener('input', () => {
        const val = Number(tSensInput.value) / 100;
        touchCtrl.setTouchSensitivity(val);
        if (tSensOut) tSensOut.textContent = `${touchCtrl.touchSensitivity.toFixed(2)}×`;
      });
    }
    syncTouchSeg();
  }

  const volSlider = menus.root.querySelector('#s-vol') as HTMLInputElement | null;
  if (volSlider) {
    volSlider.addEventListener('input', () => {
      audio.setVolume(Number(volSlider.value) / 100);
    });
  }
  audio.setVolume(menus.settings ? menus.settings.volume : 0.8);

  // Title camera tour spline across the 5-district classical Japanese village
  const camTour = {
    pos: (G.level.cinematicPath || []).map((p: any) => new THREE.Vector3(...p.pos)),
    look: (G.level.cinematicPath || []).map((p: any) => new THREE.Vector3(...p.look)),
    t: 0,
  };
  if (camTour.pos.length < 2) {
    const st = G.level.playerStart?.pos || new THREE.Vector3(-42, 0, 0);
    camTour.pos = [new THREE.Vector3(st.x, 3.0, st.z), new THREE.Vector3(st.x + 22, 4.0, st.z)];
    camTour.look = [new THREE.Vector3(st.x + 50, 5.0, st.z), new THREE.Vector3(st.x + 70, 8.0, st.z)];
  }

  const _spawnPt = new THREE.Vector3();
  const _firstSpawnPt = new THREE.Vector3();
  const _shrinePulsePos = new THREE.Vector3();

  function pickSpawnPointForVariant(variant: GenjiEnemyVariant): any {
    if (variant === 'sniper' && sniperPerches.length > 0) {
      let best = sniperPerches[0];
      let bestScore = -1e9;
      for (const p of sniperPerches) {
        const d = p.distanceTo(player.pos);
        const score = (d > 14 && d < 46 ? 38 : 0) - Math.abs(d - 26) * 0.42 + rng() * 10 - (d < 9 ? 55 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      return _spawnPt.copy(best);
    }

    const spawns: any[] = G.level.enemySpawns || [];
    const wantAir = variant === 'swarm' || variant === 'gull';
    let chosen: any = null;
    let best = -1e9;
    for (let pass = 0; pass < 2 && !chosen; pass++) {
      for (let i = 0; i < spawns.length; i++) {
        const sp = spawns[i];
        if (pass === 0 && (wantAir ? sp.type !== 'air' : sp.type === 'air')) continue;
        const d = sp.pos.distanceTo(player.pos);
        const dyPenalty = wantAir ? 0 : Math.abs(sp.pos.y - player.pos.y) * 1.6;
        const score =
          (d >= 13 && d <= 38 ? 42 : 0) -
          Math.abs(d - 23) * 0.55 -
          dyPenalty +
          rng() * 11 -
          (d < 9 ? 65 : 0);
        if (score > best) {
          best = score;
          chosen = sp.pos;
        }
      }
    }
    if (!chosen) {
      return _spawnPt.set(player.pos.x + 20, wantAir ? 6 : 0, player.pos.z);
    }
    return _spawnPt.copy(chosen);
  }

  function setupVillageShrineEvent() {
    const objs: any[] = G.level.objectives || [];
    if (!objs.length) {
      activeEventRelay = null;
      G.hud.setMarkers([]);
      touchCtrl.setInteractAvailable(false);
      return;
    }
    const relayEntry = objs[(runStats.wave / 3 | 0) % objs.length];
    const relayNode = relayEntry.object || relayEntry;
    if (relayNode.userData && relayNode.userData.setState) {
      relayNode.userData.setState('armed');
    } else if (relayEntry.setState) {
      relayEntry.setState('armed');
    }
    activeEventRelay = relayEntry;
    relayCutProgress = 0;
    G.hud.setMarkers([
      {
        id: 'village-shrine',
        short: '烽火祠',
        kind: 'relay',
        pos: relayEntry.interactPos || relayEntry.pos,
      },
    ]);
    G.hud.message('古村动态事件：前往【古村烽火祠】祈愿净火，赢取额外秘传忍法帖！', 4.5);
  }

  function clearVillageShrineEvent() {
    if (activeEventRelay) {
      const relayNode = activeEventRelay.object || activeEventRelay;
      if (relayNode && relayNode.userData && relayNode.userData.setState) {
        relayNode.userData.setState('cut');
      } else if (activeEventRelay.setState) {
        activeEventRelay.setState('cut');
      }
    }
    activeEventRelay = null;
    relayCutProgress = 0;
    G.hud.setPrompt(null);
    G.hud.setMarkers([]);
    touchCtrl.setInteractAvailable(false);
  }

  function beginNextWave() {
    runStats.wave++;
    currentWavePlan = computeWavePlan(runStats.wave);
    spawnQueue = [...currentWavePlan.spawns];
    spawnTimer = 0.3;
    waveClearDelay = -1;

    clearVillageShrineEvent();
    if (currentWavePlan.isHarborEvent) {
      setupVillageShrineEvent();
    }

    // Spawn brisk opening vanguard across the village
    const initialCount = Math.min(5, spawnQueue.length);
    let hasFirstSpawn = false;
    for (let i = 0; i < initialCount; i++) {
      const v = spawnQueue.shift()!;
      const pt = pickSpawnPointForVariant(v);
      if (!hasFirstSpawn) {
        _firstSpawnPt.copy(pt);
        hasFirstSpawn = true;
      }
      spawnGenjiVariant(v, pt, currentWavePlan.hpScale, runStats.wave);
    }

    const dirLbl = hasFirstSpawn
      ? computeWaveDirectionLabel(_firstSpawnPt.x - player.pos.x, _firstSpawnPt.z - player.pos.z)
      : '东方';
    G.hud.warn(currentWavePlan.title, 2.8);
    audio.waveBanner(currentWavePlan.isBossWave);
    G.hud.setObjective(`${currentWavePlan.title}（${dirLbl}来袭）`);
    G.hud.setRelays(Math.min(5, ((runStats.wave - 1) % 5) + 1), 5);

    // Spawn the Colossal Giant Boss automatically on Boss waves (every 3rd/5th wave) or when `?boss=1` is passed!
    if (
      currentWavePlan.isBossWave ||
      runStats.wave % 3 === 0 ||
      (runStats.wave === 1 && G.params && G.params.boss)
    ) {
      spawnColossalBoss(runStats.wave, !!(G.params && G.params.boss));
    }
  }

  function setGameState(next: string) {
    const prev = gameApi.state;
    gameApi.state = next;
    stateTime = 0;
    document.body.dataset.state =
      next === 'intro' || next === 'playing'
        ? 'playing'
        : next === 'paused'
          ? 'paused'
          : next === 'dead'
            ? 'gameover'
            : 'title';
    syncHeroWeaponVisibility();
    if (next !== prev) {
      G.events.emit('game:state', { state: next, prev });
    }
  }

  function startNewRun(opts: { skipIntro?: boolean; quick?: boolean } = {}) {
    upgradeOpen = false;
    upgradeModal.hidden = true;
    pendingDraftCount = 0;
    upgradeStacks = {};
    totalUpgradesPicked = 0;
    buildStats = createBaseGenjiStats();
    gunnerStats = createBaseGunnerStats();
    hanzoStats = createBaseHanzoStats();
    renderBuildStrip();

    const startUlt = G.params && G.params.ult ? clamp(+G.params.ult, 0, 100) : 25;
    cdState.swiftCd = 0;
    cdState.deflectCd = 0;
    cdState.deflectActiveT = 0;
    cdState.ultCharge = startUlt;
    cdState.dragonActiveT = 0;
    cdState.dragonMaxT = buildStats.dragonbladeDuration;
    cdState.dragonExtendsUsed = 0;

    gunnerCd.helixCd = 0;
    gunnerCd.bioticCd = 0;
    gunnerCd.bioticActiveT = 0;
    gunnerCd.sprintActive = false;
    gunnerCd.ultCharge = startUlt;
    gunnerCd.visorActiveT = 0;
    gunnerCd.visorMaxT = gunnerStats.visorDuration;
    gunnerCd.visorExtendsUsed = 0;

    hanzoCd.sonicCd = 0;
    hanzoCd.sonicArmed = false;
    hanzoCd.sonicActiveT = 0;
    hanzoCd.stormCd = 0;
    hanzoCd.stormActiveT = 0;
    hanzoCd.stormArrowsLeft = 0;
    hanzoCd.lungeCd = 0;
    hanzoCd.ultCharge = startUlt;
    hanzoCd.dragonActiveT = 0;
    hanzoCd.drawRatio = 0;
    hanzoLungeChargesLeft = hanzoStats.maxAirJumps;

    parryStreakCount = 0;
    parryBannerT = 0;

    runStats.time = 0;
    runStats.wave = 0;
    runStats.kills = 0;
    activeBoss = null;
    colossusState = null;
    colossusDeathT = 0;
    colossusShockwaveT = 0;
    colossusRoot.visible = false;
    colTelegraphMesh.visible = false;
    colShockwaveMesh.visible = false;
    for (const arc of bossFlameArcs) {
      arc.active = false;
      arc.mesh.visible = false;
    }
    hitstopT = 0;
    fovKick = 0;
    combatVfx.reset();
    for (const sp of deflectSpears) sp.active = false;
    deflectOuterInst.count = 0;
    deflectCoreInst.count = 0;

    G.enemies.clear();
    G.combat.reset();
    player.maxHealth =
      activeHero === 'gunner'
        ? gunnerStats.maxHealth
        : activeHero === 'hanzo'
          ? hanzoStats.maxHealth
          : buildStats.maxHealth;
    player.reset(G.level.playerStart);
    genjiWeapon.reset();
    gunnerWeapon.reset();
    hanzoWeapon.reset();
    if (activeHero === 'gunner') gunnerWeapon.onEquip();
    else if (activeHero === 'hanzo') hanzoWeapon.onEquip();
    else genjiWeapon.onEquip();
    touchCtrl.setHeroClass(activeHero);
    G.hud.reset();
    G.hud.show(true);
    menus.show('none');

    if (G.render && G.render.post) {
      G.render.post.fade = 0;
      G.render.post.saturation = 1;
    }

    const skip = !!(opts.skipIntro || opts.quick || G.params?.shot || G.params?.autostart);
    introTimer = skip ? 0 : 1.5;
    setGameState(skip ? 'playing' : 'intro');
    syncHeroWeaponVisibility();
    player.enabled = true;
    G.input.setGameplay && G.input.setGameplay(true);
    touchCtrl.setGameplayVisible(true);
    if (!skip) {
      menus.locationCard(true);
      G.hud.radio(
        activeHero === 'gunner'
          ? '神机统帅已部署花村防线。重型脉冲、螺旋飞弹与战术目镜就绪，全歼机关军团！'
          : activeHero === 'hanzo'
            ? '岛田半藏已登临花村高台。风林蓄力、音障索敌，双龙破壁肃清敌阵！'
            : '岛田源氏已抵达花村山城。飞檐走壁、心眼拔刀招架，龙刃突进斩破机关大军！',
        4.0
      );
    }
    beginNextWave();
    if (G.hud && typeof G.hud.update === 'function') {
      G.hud.update(0.016);
    }
    syncGenjiHud();
  }

  function pauseGame() {
    if ((gameApi.state !== 'playing' && gameApi.state !== 'intro') || upgradeOpen) return;
    menus.locationCard(false);
    setGameState('paused');
    player.enabled = false;
    touchCtrl.setGameplayVisible(false);
    G.input.setGameplay && G.input.setGameplay(false);
    G.input.exitLock && G.input.exitLock();
    menus.setLookMode(touchCtrl.active ? '横版双摇杆触控已启用' : G.input.describeMode());
    menus.show('paused');
    G.audio && G.audio.setPaused && G.audio.setPaused(true);
  }

  function resumeFromPause(lockMouse = false) {
    if (gameApi.state !== 'paused') return;
    menus.show('none');
    setGameState('playing');
    syncHeroWeaponVisibility();
    player.enabled = true;
    G.input.setGameplay && G.input.setGameplay(true);
    touchCtrl.setGameplayVisible(true);
    if (lockMouse && !touchCtrl.active) G.input.requestLock && G.input.requestLock();
    G.audio && G.audio.setPaused && G.audio.setPaused(false);
  }

  G.events.on('player:dead', () => {
    if (gameApi.state === 'dead') return;
    clearVillageShrineEvent();
    flushWorldProjectiles();
    setGameState('dead');
    player.enabled = false;
    touchCtrl.setGameplayVisible(false);
    G.input.setGameplay && G.input.setGameplay(false);
    G.input.exitLock && G.input.exitLock();
    menus.setDead({
      time: runStats.time,
      relays: runStats.wave,
      total: runStats.kills,
    });
    const deadRelaysEl = menus.root.querySelector('[data-f="dead-relays"]');
    if (deadRelaysEl) {
      deadRelaysEl.textContent = `第 ${runStats.wave} 波 · ${runStats.kills} 斩 · ${totalUpgradesPicked} 卷忍法`;
    }
  });

  function updateVillageShrineInteraction(dt: number) {
    if (!player.alive) {
      G.hud.setPrompt(null);
      touchCtrl.setInteractAvailable(false);
      return;
    }

    // 1. Check proximity to Ornate Boss Challenge Bell Shrines (`荒神讨伐钟`) when Colossal Boss is not active
    const bossBells: any[] = G.level && Array.isArray(G.level.bossBells) ? G.level.bossBells : [];
    if (!colossusState || colossusState.hp <= 0) {
      for (const bell of bossBells) {
        const bPos = bell.pos || bell;
        if (player.pos.distanceTo(bPos) <= 3.6) {
          touchCtrl.setInteractAvailable(true, 0);
          G.hud.setPrompt(touchCtrl.active ? '敲响荒神讨伐钟（轻触召唤巨型首领）' : '敲响荒神讨伐钟（按 F 或 B 召唤巨型首领）', 0);
          if (consumeKey(['KeyF']) || G.input.pressed('interact') || touchCtrl.isInteractHeld()) {
            G.hud.setPrompt(null);
            touchCtrl.setInteractAvailable(false);
            spawnColossalBoss(Math.max(1, runStats.wave), true);
          }
          return;
        }
      }
    }

    if (!activeEventRelay) {
      G.hud.setPrompt(null);
      touchCtrl.setInteractAvailable(false);
      return;
    }
    const rPos = activeEventRelay.interactPos || activeEventRelay.pos;
    const dist = player.pos.distanceTo(rPos);
    if (dist <= 3.0) {
      const holdingF = isKeyHeld(['KeyF']) || G.input.down('interact') || touchCtrl.isInteractHeld();
      if (holdingF) {
        relayCutProgress = Math.min(1, relayCutProgress + dt / 1.45);
        touchCtrl.setInteractAvailable(true, relayCutProgress);
        G.hud.setPrompt('点燃烽火净灵', relayCutProgress);
        if (relayCutProgress >= 1) {
          _shrinePulsePos.copy(rPos);
          clearVillageShrineEvent();
          player.heal(60);
          cdState.ultCharge = clamp(cdState.ultCharge + 38, 0, 100);
          gunnerCd.ultCharge = clamp(gunnerCd.ultCharge + 38, 0, 100);
          hanzoCd.ultCharge = clamp(hanzoCd.ultCharge + 38, 0, 100);
          pendingDraftCount++;
          pendingGuaranteedRare = true;
          audio.upgradePick();
          G.hud.warn('灵脉净火迸发 · 额外获赐秘传忍法帖！', 2.5);
          if (G.render && G.render.lightPool) {
            G.render.lightPool.flash(_shrinePulsePos, 0x3cff88, 95, 20, 0.36);
          }
          for (const en of G.enemies.list) {
            if (en.alive && en.pos.distanceTo(_shrinePulsePos) < 16) {
              en.damage(135, en.pos, player.forward, 'body');
            }
          }
        }
      } else {
        relayCutProgress = Math.max(0, relayCutProgress - dt * 1.5);
        touchCtrl.setInteractAvailable(true, relayCutProgress);
        G.hud.setPrompt(touchCtrl.active ? '古村烽火祠（按住祈愿）' : '古村烽火祠（按住 F）', relayCutProgress);
      }
    } else {
      relayCutProgress = 0;
      touchCtrl.setInteractAvailable(false);
      G.hud.setPrompt(null);
    }
  }

  const _tourP = new THREE.Vector3();
  const _tourL = new THREE.Vector3();

  function updateDynamicCameraFov(dt: number) {
    if (!G.camera || G.params?.fov) return;
    const baseFov = menus.settings ? menus.settings.fov : 75;
    const stateBoost =
      activeHero === 'gunner'
        ? gunnerCd.sprintActive
          ? 7.5
          : gunnerCd.visorActiveT > 0
            ? 3.5
            : 0
        : activeHero === 'hanzo'
          ? hanzoCd.dragonActiveT > 0
            ? 4.2
            : hanzoCd.stormActiveT > 0
              ? 2.6
              : -hanzoCd.drawRatio * 4.5
          : dashActiveT > 0 || dragonLungeActiveT > 0
            ? 11.5
            : cdState.dragonActiveT > 0
              ? 5.5
              : cdState.deflectActiveT > 0
                ? 2.0
                : 0;
    fovKick = damp(fovKick, 0, 11, dt);
    const targetFov = clamp(baseFov + stateBoost + fovKick, 58, 108);
    currentDynamicFov = damp(currentDynamicFov, targetFov, 15, dt);
    if (Math.abs(G.camera.fov - currentDynamicFov) > 0.04) {
      G.camera.fov = currentDynamicFov;
      G.camera.updateProjectionMatrix();
    }
  }

  function update(dt: number): boolean {
    stateTime += dt;

    if (gameApi.state === 'title') {
      camTour.t += dt * 0.036;
      const n = camTour.pos.length;
      const u = (camTour.t % 1) * (n - 1);
      const i0 = Math.min(n - 2, Math.floor(u));
      const f = u - i0;
      const smoothF = f * f * (3 - 2 * f);
      _tourP.lerpVectors(camTour.pos[i0], camTour.pos[i0 + 1], smoothF);
      _tourL.lerpVectors(camTour.look[i0], camTour.look[i0 + 1], smoothF);
      G.camera.position.copy(_tourP);
      G.camera.lookAt(_tourL);
      if (!G.params?.fov && Math.abs(G.camera.fov - 56) > 0.05) {
        G.camera.fov = 56;
        G.camera.updateProjectionMatrix();
      }
      abilityPressed.clear();
      return false;
    }

    if (gameApi.state === 'paused') {
      if (stateTime > 0.15 && G.input.pressed('pause')) {
        if (!menus.closePanel()) resumeFromPause(false);
      }
      abilityPressed.clear();
      return false;
    }

    if (gameApi.state === 'dead') {
      if (G.render && G.render.post) {
        G.render.post.saturation = damp(G.render.post.saturation ?? 1, 0.15, 2.2, dt);
        G.render.post.fade = damp(G.render.post.fade || 0, 0.52, 1.4, dt);
      }
      if (stateTime > 1.2 && menus.screen !== 'dead') {
        menus.show('dead');
      }
      abilityPressed.clear();
      return true;
    }

    if (upgradeOpen) {
      syncGenjiHud();
      abilityPressed.clear();
      return false;
    }

    if (G.input.pressed('pause')) {
      pauseGame();
      abilityPressed.clear();
      return false;
    }

    syncHeroWeaponVisibility();
    updateDynamicCameraFov(dt);

    // Sim-Level Hitstop with Asymmetric Time-Dilation Recovery Curve
    if (hitstopT > 0) {
      hitstopT = Math.max(0, hitstopT - dt);
      const visScale = combatVfx.getHitstopVisualScale(hitstopT);
      parryBannerT = Math.max(0, parryBannerT - dt * 0.5);
      if (activeHero === 'gunner') gunnerWeapon.updateVisualsOnly(dt * visScale);
      else if (activeHero === 'hanzo') hanzoWeapon.updateVisualsOnly(dt * visScale);
      else genjiWeapon.updateVisualsOnly(dt * visScale);
      combatVfx.update(dt * Math.max(0.28, visScale));
      syncGenjiHud();
      return false;
    }

    if (gameApi.state === 'intro') {
      introTimer -= dt;
      if (introTimer <= 0) {
        menus.locationCard(false);
        setGameState('playing');
      }
    }

    runStats.time += dt;
    parryBannerT = Math.max(0, parryBannerT - dt);

    // Tick Genji, Gunner & Hanzo Cooldowns + Biotic Tactical Field Healing Aura
    cdState.swiftCd = Math.max(0, cdState.swiftCd - dt);
    cdState.deflectCd = Math.max(0, cdState.deflectCd - dt);
    if (cdState.deflectActiveT > 0) {
      cdState.deflectActiveT = Math.max(0, cdState.deflectActiveT - dt);
      if (cdState.deflectActiveT === 0) {
        triggerDeflectIaidoFinisher();
      }
    }
    if (cdState.dragonActiveT > 0) {
      cdState.dragonActiveT = Math.max(0, cdState.dragonActiveT - dt);
    } else {
      cdState.ultCharge = clamp(cdState.ultCharge + dt * 1.65 * buildStats.ultChargeMultiplier, 0, 100);
    }

    gunnerCd.helixCd = Math.max(0, gunnerCd.helixCd - dt);
    gunnerCd.bioticCd = Math.max(0, gunnerCd.bioticCd - dt);
    if (gunnerCd.bioticActiveT > 0) {
      gunnerCd.bioticActiveT = Math.max(0, gunnerCd.bioticActiveT - dt);
      if (isPlayerInsideBioticField()) {
        bioticHealFrac += gunnerStats.bioticHealPerSec * dt;
        const healWhole = Math.floor(bioticHealFrac);
        if (healWhole >= 1) {
          bioticHealFrac -= healWhole;
          player.heal(healWhole);
        }
      }
    }
    if (gunnerCd.visorActiveT > 0) {
      gunnerCd.visorActiveT = Math.max(0, gunnerCd.visorActiveT - dt);
    } else {
      gunnerCd.ultCharge = clamp(gunnerCd.ultCharge + dt * 1.65 * gunnerStats.ultChargeMultiplier, 0, 100);
    }

    hanzoCd.sonicCd = Math.max(0, hanzoCd.sonicCd - dt);
    hanzoCd.stormCd = Math.max(0, hanzoCd.stormCd - dt);
    hanzoCd.lungeCd = Math.max(0, hanzoCd.lungeCd - dt);
    if (hanzoCd.stormActiveT > 0) {
      hanzoCd.stormActiveT = Math.max(0, hanzoCd.stormActiveT - dt);
      if (hanzoCd.stormActiveT <= 0) {
        hanzoCd.stormArrowsLeft = 0;
      }
    }
    if (hanzoCd.dragonActiveT > 0) {
      hanzoCd.dragonActiveT = Math.max(0, hanzoCd.dragonActiveT - dt);
    } else {
      hanzoCd.ultCharge = clamp(hanzoCd.ultCharge + dt * 1.65 * hanzoStats.ultChargeMultiplier, 0, 100);
    }

    dashGraceT = Math.max(0, dashGraceT - dt);
    swiftResetFlashT = Math.max(0, swiftResetFlashT - dt);

    // Ability Key Triggers (`Shift`, `E`, `Q`, `B`) — Mid-run hero switching (`Tab`) is intentionally removed!
    consumeKey(['Tab']);
    if (consumeKey(['ShiftLeft', 'ShiftRight'])) {
      if (activeHero === 'gunner') toggleGunnerSprint();
      else if (activeHero === 'hanzo') toggleSonicArrow();
      else tryCastSwiftStrike();
    }
    if (consumeKey(['KeyE'])) {
      if (activeHero === 'gunner') tryCastBioticField();
      else if (activeHero === 'hanzo') activateStormArrows();
      else tryCastDeflect();
    }
    if (consumeKey(['KeyQ'])) {
      if (activeHero === 'gunner') tryCastTacticalVisor();
      else if (activeHero === 'hanzo') tryCastDragonstrike();
      else tryCastDragonblade();
    }
    if (consumeKey(['KeyB'])) {
      spawnColossalBoss(Math.max(1, runStats.wave), true);
    }

    abilityPressed.clear();

    updateDeflectSystem(dt);
    updateColossalBoss(dt);
    updateSpecialEnemyBehaviors(dt);
    updateVillageShrineInteraction(dt);
    combatVfx.update(dt);

    // Trickle-spawn wave enemies up to `maxConcurrent`
    const aliveNow = G.enemies.aliveCount();
    const colossusCount = colossusState && colossusState.hp > 0 ? 1 : 0;
    if (spawnQueue.length > 0 && aliveNow < currentWavePlan.maxConcurrent) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = 0.52;
        const nextVar = spawnQueue.shift()!;
        const pt = pickSpawnPointForVariant(nextVar);
        spawnGenjiVariant(nextVar, pt, currentWavePlan.hpScale, runStats.wave);
      }
    }

    // Update top-left Wave & Remaining Hostiles objective readout
    const totalRemaining = aliveNow + spawnQueue.length + colossusCount;
    const objText =
      colossusCount > 0
        ? `第 ${runStats.wave} 波 · 巨型荒神降临（敌军 ${totalRemaining}）`
        : totalRemaining > 0
          ? `第 ${runStats.wave} 波 · 剩余敌军 ${totalRemaining}`
          : `第 ${runStats.wave} 波已肃清！`;
    if (objText !== lastObjText) {
      lastObjText = objText;
      const objTitleEl = hudRoot.querySelector('.h-obj-t');
      const objBoxEl = hudRoot.querySelector('.h-obj');
      if (objTitleEl && objBoxEl) {
        objBoxEl.classList.add('has');
        objTitleEl.textContent = objText;
      }
    }

    // Wave Clear -> Heal + Open 3-Choice Tactical Draft!
    if (spawnQueue.length === 0 && aliveNow === 0 && colossusCount === 0 && colossusDeathT <= 0 && player.alive) {
      if (waveClearDelay < 0) {
        waveClearDelay = 0.95;
        player.heal(45);
        genjiWeapon.ammo = buildStats.magSize;
        gunnerWeapon.ammo = gunnerStats.magSize;
        G.hud.message(`第 ${runStats.wave} 波肃清 · 准备选择战术强化`, 1.1);
      } else {
        waveClearDelay -= dt;
        if (waveClearDelay <= 0) {
          waveClearDelay = -1;
          const isSpecial = currentWavePlan.isBossWave;
          openUpgradeDraft(
            isSpecial
              ? `第 ${runStats.wave} 波首领讨伐成功 · 必出秘传/奥义强化（已恢复生命）`
              : `第 ${runStats.wave} 波肃清 · 用时 ${formatTime(runStats.time)} · 已恢复 45 生命`,
            isSpecial || pendingGuaranteedRare
          );
          pendingGuaranteedRare = false;
        }
      }
    }

    const wantIntensity =
      cdState.dragonActiveT > 0 ||
      gunnerCd.visorActiveT > 0 ||
      hanzoCd.dragonActiveT > 0 ||
      currentWavePlan.isBossWave
        ? 1
        : aliveNow > 0
          ? 0.65
          : 0.2;
    G.audio && G.audio.setIntensity && G.audio.setIntensity(wantIntensity);

    syncGenjiHud();
    return true;
  }

  let lastObjText = '';

  const gameApi = {
    state: 'title',
    run: runStats,
    menus,
    cdState,
    gunnerCd,
    hanzoCd,
    touch: touchCtrl,
    genjiWeapon,
    gunnerWeapon,
    hanzoWeapon,
    combatVfx,
    get hero() {
      return activeHero;
    },
    setHero(h: HeroClassId): boolean {
      return setHeroClass(h, false);
    },
    returnToTitle: returnToHeroSelect,
    restartWithHero,
    get upgradeStacks() {
      return { ...upgradeStacks };
    },
    get stats() {
      return buildStats;
    },
    get gunnerStats() {
      return gunnerStats;
    },
    get hanzoStats() {
      return hanzoStats;
    },
    get upgradeOpen() {
      return upgradeOpen;
    },
    start(opts: { skipIntro?: boolean; quick?: boolean } = {}) {
      startNewRun(opts);
    },
    pause: pauseGame,
    resume: () => resumeFromPause(false),
    update,
    castSwift: tryCastSwiftStrike,
    castDeflect: tryCastDeflect,
    castDragonblade: tryCastDragonblade,
    castSprint: toggleGunnerSprint,
    castBiotic: tryCastBioticField,
    castVisor: tryCastTacticalVisor,
    castSonic: toggleSonicArrow,
    castStorm: activateStormArrows,
    castDragonstrike: tryCastDragonstrike,
    fireHelix: () => gunnerWeapon.fireHelixVolley(),
    summonColossalBoss: () => spawnColossalBoss(Math.max(1, runStats.wave), true),
    get colossus() {
      return colossusState;
    },
    grantUlt() {
      cdState.ultCharge = 100;
      gunnerCd.ultCharge = 100;
      hanzoCd.ultCharge = 100;
    },
    openDraftForTest() {
      openUpgradeDraft('波次肃清赐福 · 已恢复 45 生命', true);
    },
    chooseUpgradeForTest(idx: number) {
      chooseUpgrade(idx);
    },
    getDiagnostics() {
      return {
        genjiBlade: genjiWeapon.getBladeDiagnostics(),
        hanzoPool: hanzoWeapon.getPoolDiagnostics(),
        enemyPool: getEnemyPoolDiagnostics(),
        combatBatching: combatVfx.sampleTelemetry(),
      };
    },
    getActiveProjectileStats() {
      const bolts: any[] =
        G.enemies && G.enemies.debug && G.enemies.debug.bolts ? G.enemies.debug.bolts : [];
      let activeBolts = 0;
      for (let i = 0; i < bolts.length; i++) {
        if (bolts[i].on) activeBolts++;
      }
      return {
        shurikens: genjiWeapon.getActiveProjectileCount(),
        pulseBolts: gunnerWeapon.getActiveProjectileCount(),
        arrows: hanzoWeapon.getActiveProjectileCount(),
        deflectSpears: deflectOuterInst.count,
        enemyBolts: activeBolts,
      };
    },
  };

  // Pre-warm Genji, Gunner & Hanzo viewmodel shaders on `G.viewCamera` on hardware GPUs (skip on SwiftShader CPU WebGL!)
  try {
    if (!G.__isSoftwareGl && G.renderer && G.scene && G.viewCamera && typeof G.renderer.compile === 'function') {
      genjiWeapon.setVisible(true);
      gunnerWeapon.setVisible(true);
      hanzoWeapon.setVisible(true);
      G.renderer.compile(G.scene, G.viewCamera);
    }
  } catch {
    // Ignore shader pre-warm fallback errors on headless/stub contexts
  }

  // Initial state setup (boots into Title unless `?autostart=1` or `?shot=1`)
  setHeroClass(activeHero, true);
  player.enabled = false;
  G.hud.show(false);
  syncHeroWeaponVisibility();
  touchCtrl.setGameplayVisible(false);
  G.input.setGameplay && G.input.setGameplay(false);
  document.body.dataset.state = 'title';
  if (!(G.params && (G.params.shot || G.params.autostart))) {
    menus.show('title');
  }

  if (typeof window !== 'undefined') {
    (window as any).__runQaSuite = () =>
      import('./qaPipeline.ts').then((m) => m.runFullQaSuite({ liveG: G }));
  }

  return gameApi;
}
