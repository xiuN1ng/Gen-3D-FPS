import './headlessDomShim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  UPGRADE_CATALOG,
  SYNERGY_CATALOG,
  GUNNER_UPGRADE_OVERRIDES,
  HANZO_UPGRADE_OVERRIDES,
  computeGenjiBuildStats,
  computeGunnerBuildStats,
  computeHanzoBuildStats,
  evaluateBuildSynergies,
  computeDraftCardSynergyPreview,
  createColossalBossState,
  beginColossalThunderJudgment,
  stepColossalBossDamage,
} from './roguelike.ts';
import { createCombatFeelVfx } from './combatFeelVfx.ts';
import { createTacticalArenaProps } from './tacticalArenaProps.ts';
import { installGenjiRoguelikeMode } from './genjiMode.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

function createMockEventBus() {
  const listeners = new Map<string, Array<(payload?: any) => void>>();
  return {
    on(event: string, fn: (payload?: any) => void) {
      let arr = listeners.get(event);
      if (!arr) {
        arr = [];
        listeners.set(event, arr);
      }
      arr.push(fn);
      return () => {
        const list = listeners.get(event);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    emit(event: string, payload?: any) {
      const list = listeners.get(event);
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        list[i](payload);
      }
    },
  };
}

function createSilentAudioStub(): any {
  return new Proxy(
    {},
    {
      get: () => () => {},
    }
  );
}

test('Phase 3-2: Expanded 20-card talent pool & 6-pair Dual-Synergy Resonance Engine scale cleanly across Genji, Gunner, and Hanzo', () => {
  assert.equal(UPGRADE_CATALOG.length, 20, 'Expected 20 total roguelike upgrade cards');
  assert.equal(SYNERGY_CATALOG.length, 6, 'Expected all 6 cross-archetype synergy pairs');

  const byArch: Record<string, number> = { shuriken: 0, mobility: 0, deflect: 0, dragon: 0 };
  for (const card of UPGRADE_CATALOG) {
    byArch[card.archetype] = (byArch[card.archetype] || 0) + 1;
    const uCopy = GUNNER_UPGRADE_OVERRIDES[card.id];
    const hCopy = HANZO_UPGRADE_OVERRIDES[card.id];
    assert.ok(uCopy, `Missing GUNNER_UPGRADE_OVERRIDES for ${card.id}`);
    assert.ok(hCopy, `Missing HANZO_UPGRADE_OVERRIDES for ${card.id}`);
    assert.notEqual(card.title, uCopy.title, `Genji vs Gunner title collision on ${card.id}`);
    assert.notEqual(card.title, hCopy.title, `Genji vs Hanzo title collision on ${card.id}`);
    assert.notEqual(uCopy.title, hCopy.title, `Gunner vs Hanzo title collision on ${card.id}`);
  }
  assert.deepEqual(byArch, { shuriken: 5, mobility: 6, deflect: 4, dragon: 5 });

  // Verify the 4 newly added talents scale hero build stats monotonically
  const baseGenji = computeGenjiBuildStats({});
  const boostedGenji = computeGenjiBuildStats({
    shuriken_thunder: 2,
    swift_gale: 2,
    deflect_tempest: 2,
    dragon_ascension: 1,
  });
  assert.ok(boostedGenji.shurikenDamage > baseGenji.shurikenDamage);
  assert.ok(boostedGenji.swiftStrikeCooldown < baseGenji.swiftStrikeCooldown);
  assert.ok(boostedGenji.deflectMultiplier > baseGenji.deflectMultiplier);
  assert.ok(boostedGenji.dragonbladeWaveDamage > baseGenji.dragonbladeWaveDamage);

  const baseGunner = computeGunnerBuildStats({});
  const boostedGunner = computeGunnerBuildStats({
    shuriken_thunder: 2,
    swift_gale: 2,
    deflect_tempest: 2,
    dragon_ascension: 1,
  });
  assert.ok(boostedGunner.rifleDamage > baseGunner.rifleDamage);
  assert.ok(boostedGunner.helixSplashRadius > baseGunner.helixSplashRadius);
  assert.ok(boostedGunner.bioticFireRateBonus > baseGunner.bioticFireRateBonus);
  assert.ok(boostedGunner.visorDuration > baseGunner.visorDuration);

  const baseHanzo = computeHanzoBuildStats({});
  const boostedHanzo = computeHanzoBuildStats({
    shuriken_thunder: 2,
    swift_gale: 2,
    deflect_tempest: 2,
    dragon_ascension: 1,
  });
  assert.ok(boostedHanzo.headshotMultiplier > baseHanzo.headshotMultiplier);
  assert.ok(boostedHanzo.lungeCooldown < baseHanzo.lungeCooldown);
  assert.ok(boostedHanzo.sonicAmpMultiplier > baseHanzo.sonicAmpMultiplier);
  assert.ok(boostedHanzo.dragonstrikeDps > baseHanzo.dragonstrikeDps);

  // Verify Tier I (1+1) unlock and Tier II (sum >= 4) awakening + Draft Card Synergy Preview
  const singleStack = { shuriken_thunder: 1 };
  const initialSyn = evaluateBuildSynergies(singleStack, 'genji');
  assert.equal(initialSyn.active.length, 0);

  const unlockPreview = computeDraftCardSynergyPreview(singleStack, 'swift_gale', 'genji');
  assert.ok(unlockPreview, 'Expected synergy unlock preview when holding shuriken and viewing mobility card');
  assert.equal(unlockPreview.kind, 'unlock');
  assert.equal(unlockPreview.synergyId, 'gale_volley');
  assert.equal(unlockPreview.nextTier, 1);
  assert.ok(unlockPreview.badgeLabel.includes('羁绊激活'));

  const tier1Stacks = { shuriken_thunder: 2, swift_gale: 1 };
  const tier1Syn = evaluateBuildSynergies(tier1Stacks, 'genji');
  assert.equal(tier1Syn.tiers.gale_volley, 1);
  assert.equal(tier1Syn.mobilityEmpowerRatio, 0.28);

  const upgradePreview = computeDraftCardSynergyPreview(tier1Stacks, 'swift_gale', 'genji');
  assert.ok(upgradePreview, 'Expected Tier II upgrade preview when archetype sum reaches 4');
  assert.equal(upgradePreview.kind, 'upgrade');
  assert.equal(upgradePreview.synergyId, 'gale_volley');
  assert.equal(upgradePreview.nextTier, 2);
  assert.ok(upgradePreview.badgeLabel.includes('II'));

  // Full 4-archetype build activates all 6 synergies at Tier II across all 3 heroes
  const omniStacks = {
    shuriken_thunder: 2,
    swift_gale: 2,
    deflect_tempest: 2,
    dragon_ascension: 2,
  };
  for (const hero of ['genji', 'gunner', 'hanzo'] as const) {
    const full = evaluateBuildSynergies(omniStacks, hero);
    assert.equal(full.active.length, 6, `Expected 6 active synergies for ${hero}`);
    assert.ok(full.active.every((s) => s.tier === 2), `Expected all synergies at Tier II for ${hero}`);
    assert.equal(full.mobilityEmpowerRatio, 0.45);
    assert.equal(full.parryBonusKunai, 4);
    assert.equal(full.pairedWardHeal, 40);
    assert.equal(full.precisionBurstDamage, 105);
    assert.equal(full.aerialDamageBonus, 0.40);
    assert.equal(full.ultCastPulseDamage, 225);
  }
});

test('Phase 3-2: Colossal Boss Phase 2/3 thunder_judgment exposes chest Raijin Heart Core (orbIndex=4) for precision interrupt & backlash stagger', () => {
  const boss = createColossalBossState(3);
  boss.phase = 2;
  assert.equal(boss.coreExposed, false);
  assert.equal(boss.interruptCount, 0);

  beginColossalThunderJudgment(boss);
  assert.equal(boss.activeAttack, 'thunder_judgment');
  assert.equal(boss.coreExposed, true);
  assert.ok((boss.coreHp ?? 0) >= 115);
  assert.ok(Math.abs(boss.attackTimer - 1.18) < 1e-6);

  const hpBefore = boss.hp;
  const firstShot = stepColossalBossDamage(boss, 80, 4);
  assert.equal(firstShot.totalDamage, 120, 'Heart core must take 1.5x precision damage');
  assert.equal(firstShot.coreInterrupted, false);
  assert.equal(boss.coreExposed, true);

  // Finishing off the exposed heart-core interrupts thunder_judgment, deals +8% maxHP backlash, and staggers for 2.0s!
  const expectedBacklash = Math.round(boss.maxHp * 0.08);
  const interruptShot = stepColossalBossDamage(boss, 120, 4);
  assert.equal(interruptShot.coreInterrupted, true);
  assert.equal(interruptShot.totalDamage, Math.round(120 * 1.5) + expectedBacklash);
  assert.equal(boss.coreExposed, false);
  assert.equal(boss.activeAttack, null);
  assert.equal(boss.attackTimer, 0);
  assert.ok(boss.stunTimer >= 2.0, `Expected >=2.0s boss stagger after core shatter, got ${boss.stunTimer}`);
  assert.equal(boss.interruptCount, 1);
  assert.equal(boss.hp, hpBefore - firstShot.totalDamage - interruptShot.totalDamage);
});

test('Phase 3-2: Zero-GC GPU-instanced Hanamura Tactical Arena Props (Raijin Sake Casks, Fujin Updrafts, Sacred Spirit Gongs)', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
  const events = createMockEventBus();

  const mockShieldEnemy: any = {
    id: 501,
    alive: true,
    hp: 320,
    pos: new THREE.Vector3(-43.2, 0, -4.4), // within 6.5m of Cask #0 (-44.5, 0, -4.6)
    __bypassShieldOnce: false,
    __guardBrokenT: 0,
    __bleedT: 0,
    __bleedDps: 0,
    damage(amt: number) {
      this.hp = Math.max(0, this.hp - amt);
      if (this.hp <= 0) {
        this.alive = false;
        return true;
      }
      return false;
    },
  };

  const mockGongEnemy: any = {
    id: 502,
    alive: true,
    hp: 200,
    pos: new THREE.Vector3(-49.0, 0, 8.2), // within 10.5m of Gong #0 (-52.0, 0, 8.8)
    __bypassShieldOnce: false,
    __guardBrokenT: 0,
    __gongStaggerT: 0,
    damage(amt: number) {
      this.hp = Math.max(0, this.hp - amt);
      if (this.hp <= 0) {
        this.alive = false;
        return true;
      }
      return false;
    },
  };

  const player = {
    alive: true,
    onGround: true,
    pos: new THREE.Vector3(-40, 0, 0),
    vel: new THREE.Vector3(0, 0, 0),
    forward: new THREE.Vector3(0, 0, -1),
    addShake() {},
  };

  let healedTotal = 0;
  let ultGrantedTotal = 0;
  let bossCleaves = 0;

  const G: Record<string, any> = {
    THREE,
    scene,
    camera,
    events,
    player,
    enemies: {
      list: [mockShieldEnemy, mockGongEnemy],
    },
    render: {
      lightPool: { flash() {} },
    },
  };

  const combatVfx = createCombatFeelVfx(G);
  G.combatVfx = combatVfx;

  const props = createTacticalArenaProps(G, {
    onPlayerHeal: (amt) => {
      healedTotal += amt;
    },
    onGrantUltCharge: (pct) => {
      ultGrantedTotal += pct;
    },
    cleaveColossalBoss: () => {
      bossCleaves++;
      return { hit: true, killed: false, orbShattered: false };
    },
  });

  const initDiag = props.getDiagnostics();
  assert.equal(initDiag.totalProps, 14);
  assert.equal(initDiag.aliveCasks, 6);
  assert.equal(initDiag.updraftVents, 4);
  assert.equal(initDiag.readyGongs, 4);

  // Batch telemetry records 45 eliminated permanent scene meshes ((6*4-1) + (4*2-1) + (4*4-1))
  const vfxSnap = combatVfx.sampleTelemetry();
  assert.equal(vfxSnap.eliminatedSceneMeshes, 45);

  // 1. Raycast & detonate Raijin Sake Cask #0 at (-44.5, 0.56, -4.6)
  const caskRay = props.raycast({ x: -44.5, y: 0.56, z: 0.0 }, { x: 0, y: 0, z: -1 }, 20);
  assert.ok(caskRay, 'Expected raycast hit against Raijin Sake Cask #0');
  assert.equal(caskRay.kind, 'sake_cask');
  const caskOutcome = props.triggerHit(caskRay.propIndex, 50);
  assert.equal(caskOutcome.triggered, true);
  assert.equal(caskOutcome.kind, 'sake_cask');
  assert.equal(caskOutcome.enemiesHit, 1);
  assert.equal(caskOutcome.bossHit, true);
  assert.ok(mockShieldEnemy.hp < 320, 'Cask blast must deal heavy AoE damage');
  assert.ok(mockShieldEnemy.__guardBrokenT >= 1.8, 'Cask blast must guard-break shielded enemies');
  assert.equal(mockShieldEnemy.__bleedT, 3.0, 'Cask blast must ignite 3.0s burn DoT');
  assert.equal(props.getDiagnostics().aliveCasks, 5);

  // 2. Step player onto Fujin Spirit Updraft Vent #0 at (-31.5, 0.0, -9.5)
  assert.equal(props.getDamageMultiplier(), 1.0);
  player.pos.set(-31.5, 0.0, -9.5);
  player.vel.set(0, 0, 0);
  props.update(1 / 60, player);
  assert.ok(player.vel.y >= 11.4, `Expected updraft vertical launch >= 11.4 m/s, got ${player.vel.y}`);
  assert.equal(player.onGround, false);
  assert.ok(props.getUpdraftBuffRemaining() > 3.0);
  assert.equal(props.getDamageMultiplier(), 1.18);
  assert.equal(props.getDiagnostics().updraftLaunches, 1);

  // 3. Raycast & ring Sacred Resonance Spirit Gong #0 at (-52.0, 1.24, 8.8)
  const gongRay = props.raycast({ x: -52.0, y: 1.24, z: 4.0 }, { x: 0, y: 0, z: 1 }, 20);
  assert.ok(gongRay, 'Expected raycast hit against Sacred Spirit Gong #0');
  assert.equal(gongRay.kind, 'spirit_gong');
  const gongOutcome = props.triggerHit(gongRay.propIndex, 28);
  assert.equal(gongOutcome.triggered, true);
  assert.equal(gongOutcome.kind, 'spirit_gong');
  assert.equal(gongOutcome.playerHealed, 42);
  assert.equal(gongOutcome.ultGainPct, 12);
  assert.equal(healedTotal, 42);
  assert.equal(ultGrantedTotal, 12);
  assert.equal(mockGongEnemy.hp, 200 - 85);
  assert.equal(mockGongEnemy.__gongStaggerT, 1.2);
  assert.equal(props.getDiagnostics().readyGongs, 3);
  assert.ok(bossCleaves >= 2);

  // Gong on 20s cooldown ignores immediate second hit, then resets cleanly on next wave!
  const repeatGong = props.triggerHit(gongRay.propIndex, 28);
  assert.equal(repeatGong.triggered, false);

  props.onWaveStart();
  const resetDiag = props.getDiagnostics();
  assert.equal(resetDiag.aliveCasks, 6, 'onWaveStart must respawn detonated sake casks');
  assert.equal(resetDiag.readyGongs, 4, 'onWaveStart must refresh sacred gong cooldowns');

  props.dispose();
  combatVfx.dispose();
});

test('Phase 3-2: Integrated GenjiRoguelikeMode renders synergy badges/chips, executes paired skill resonances, and eliminates >=415 scene meshes', () => {
  const uiEl = document.getElementById('ui') || document.body;
  uiEl.innerHTML = '';
  const hudRoot = document.createElement('div');
  hudRoot.innerHTML = '<div class="health"></div><div id="w-name"></div><div id="ammo-res"></div>';
  uiEl.appendChild(hudRoot);

  const events = createMockEventBus();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
  const viewCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 20);
  scene.add(camera, viewCamera);

  const mockG: Record<string, any> = {
    THREE,
    scene,
    camera,
    viewCamera,
    events,
    __isSoftwareGl: true,
    params: {},
    renderer: {
      capabilities: { getMaxAnisotropy: () => 4 },
      info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
      compile() {},
    },
    render: {
      sun: new THREE.DirectionalLight(0xffffff, 2.5),
      hemi: new THREE.HemisphereLight(0xffffff, 0x444444, 0.7),
      post: { flash: 0, saturation: 1, fade: 0 },
      lightPool: { flash() {} },
      setFovPunch() {},
    },
    fx: {
      burst() {},
      muzzle() {},
      impact() {},
      ring() {},
      beam() {},
      decal() {},
      clear() {},
      update() {},
    },
    audio: createSilentAudioStub(),
    physics: {
      raycast: () => null,
      lineOfSight: () => true,
      groundHeight: () => 0,
      moveCapsule: (pos: THREE.Vector3, vel: THREE.Vector3, dt: number) => {
        pos.addScaledVector(vel, dt);
        return { onGround: pos.y <= 0.01 };
      },
    },
    level: {
      playerStart: { pos: new THREE.Vector3(-42, 0, 0), yaw: 0 },
      enemySpawns: [{ pos: new THREE.Vector3(-18, 0, 0), type: 'ground' }],
      objectives: [],
      cinematicPath: [],
      damageInRadius: () => 0,
    },
    input: {
      move: { x: 0, y: 0 },
      look: { dx: 0, dy: 0 },
      fire: false,
      ads: false,
      sprint: false,
      crouch: false,
      locked: true,
      touch: false,
      mode: 'lock',
      sensitivity: 1,
      invertY: false,
      down: () => false,
      pressed: () => false,
      setGameplay() {},
      requestLock() {},
      exitLock() {},
      describeMode: () => '',
    },
    player: {
      pos: new THREE.Vector3(-42, 0, 0),
      vel: new THREE.Vector3(),
      eye: new THREE.Vector3(-42, 1.65, 0),
      forward: new THREE.Vector3(1, 0, 0),
      yaw: 0,
      pitch: 0,
      health: 225,
      maxHealth: 225,
      alive: true,
      onGround: true,
      sprinting: false,
      crouching: false,
      ads: 0,
      speed: 8.6,
      invulnerable: false,
      enabled: false,
      tuning: { walk: 6, sprint: 8, accelAir: 20 },
      reset(st: any) {
        if (st?.pos) this.pos.copy(st.pos);
        this.alive = true;
        this.health = this.maxHealth;
      },
      damage(amt: number) {
        this.health = Math.max(0, this.health - amt);
      },
      heal(amt: number) {
        this.health = Math.min(this.maxHealth, this.health + amt);
      },
      addRecoil() {},
      addShake() {},
      setFov() {},
      update() {},
    },
    combat: {
      stats: { shots: 0, hits: 0, kills: 0 },
      reset() {},
      raycastEnemy: () => null,
      damageEnemy() {},
    },
    weapon: { setVisible() {}, reset() {}, update() {} },
    enemies: {
      list: [],
      debug: { bolts: [] },
      raycast: () => null,
      clear() {
        this.list.length = 0;
      },
      spawn() {
        return null;
      },
      aliveCount: () => 0,
      alert() {},
      update() {},
    },
    hud: {
      root: hudRoot,
      show() {},
      reset() {},
      setObjective() {},
      setRelays() {},
      setMarkers() {},
      setPrompt() {},
      message() {},
      warn() {},
      radio() {},
      clearRadio() {},
      feed() {},
      hitmarker() {},
      damageDir() {},
      update() {},
    },
  };

  const mockMenuFactory = (_g: any, handlers: any) => {
    const mRoot = document.createElement('div');
    mRoot.className = 'menus';
    mRoot.innerHTML = `
      <button data-hero-pick="genji" class="active" aria-pressed="true"></button>
      <button data-hero-pick="hanzo" aria-pressed="false"></button>
      <button data-hero-pick="gunner" aria-pressed="false"></button>
      <button data-act="reselect-hero"></button>
    `;
    uiEl.appendChild(mRoot);
    let scr = 'title';
    return {
      root: mRoot,
      handlers,
      get screen() {
        return scr;
      },
      get panelOpen() {
        return false;
      },
      closePanel: () => false,
      show(s: string) {
        scr = s;
      },
      locationCard() {},
      setLookMode() {},
      setDead() {},
      setDebrief() {},
      applySettings() {},
    };
  };

  const game = installGenjiRoguelikeMode(mockG, mockMenuFactory);
  game.start({ skipIntro: true });

  const diag = game.getDiagnostics();
  assert.ok(
    diag.combatBatching.eliminatedSceneMeshes >= 415,
    `Expected >=415 eliminated permanent scene meshes across weapons + boss + tactical props, got ${diag.combatBatching.eliminatedSceneMeshes}`
  );
  assert.equal(diag.tacticalProps.totalProps, 14);

  // Pick 1st card -> open 2nd draft -> cards from different archetypes must display `.g-card-syn` golden preview badge!
  game.openDraftForTest();
  game.chooseUpgradeForTest(0);
  const firstPickedId = Object.keys(game.upgradeStacks)[0];
  const firstCardDef = UPGRADE_CATALOG.find((c) => c.id === firstPickedId)!;

  // Draft until a cross-archetype card is offered and pick it to unlock a live synergy
  let sawSynergyBadge = false;
  for (let attempt = 0; attempt < 6 && game.synergies.active.length === 0; attempt++) {
    game.openDraftForTest();
    const synBadges = uiEl.querySelectorAll('.g-card-syn');
    if (synBadges.length > 0) {
      sawSynergyBadge = true;
    }
    const cardEls = [...uiEl.querySelectorAll('.g-card')];
    let pickIdx = 0;
    for (let i = 0; i < cardEls.length; i++) {
      if (cardEls[i].querySelector('.g-card-syn')) {
        pickIdx = i;
        break;
      }
    }
    game.chooseUpgradeForTest(pickIdx);
  }

  assert.ok(
    sawSynergyBadge,
    `Expected .g-card-syn preview badge in draft modal after holding ${firstCardDef.id}`
  );
  assert.ok(game.synergies.active.length >= 1, 'Expected at least 1 active dual-synergy unlocked');
  const synChips = uiEl.querySelectorAll('.g-chip.g-chip-syn');
  assert.ok(synChips.length >= 1, 'Expected .g-chip-syn active resonance emblem rendered in .g-build-strip');
});
