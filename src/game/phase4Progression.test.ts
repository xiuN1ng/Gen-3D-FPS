import './headlessDomShim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CAREER_STORAGE_KEY,
  CHALLENGE_MUTATORS,
  DIFFICULTY_TIERS,
  HOSTILE_CODEX_SPECS,
  computeCareerRank,
  computeChallengeModifiers,
  createCareerStore,
  parseCareerProfile,
  type StorageLike,
} from './careerProgression.ts';
import { SYNERGY_CATALOG, UPGRADE_CATALOG, type SynergyPairId, type SynergyTier } from './roguelike.ts';
import { createGenjiAudio } from './genjiAudio.ts';
import { installGenjiRoguelikeMode } from './genjiMode.ts';
import { createPerfHud, shouldAutoCollapsePerfHud } from './perfHud.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

function createMemoryStorage(): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => {
      raw.set(k, v);
    },
  };
}

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

test('Phase 4: Difficulty Tiers & Shura Challenge Mutators preserve 1.0x default parity and compose deterministically', () => {
  assert.equal(DIFFICULTY_TIERS.length, 3);
  assert.equal(CHALLENGE_MUTATORS.length, 4);

  const base = computeChallengeModifiers('normal', []);
  assert.equal(base.enemyHpMult, 1.0);
  assert.equal(base.enemyDamageMult, 1.0);
  assert.equal(base.enemySpeedMult, 1.0);
  assert.equal(base.spawnIntervalScale, 1.0);
  assert.equal(base.playerMaxHpMult, 1.0);
  assert.equal(base.playerDamageMult, 1.0);
  assert.equal(base.playerUltGainMult, 1.0);
  assert.equal(base.waveHealMult, 1.0);
  assert.equal(base.vampiricKillHeal, 0);
  assert.equal(base.propCooldownScale, 1.0);
  assert.equal(base.propDamageMult, 1.0);
  assert.equal(base.scoreMultiplier, 1.0);

  // Abyss + all 4 mutators (with duplicate/invalid filtering)
  const omni = computeChallengeModifiers('abyss', [
    'blood_moon',
    'overclock_legion',
    'volatile_arena',
    'glass_cannon',
    'blood_moon',
  ]);
  assert.equal(omni.mutators.length, 4, 'Duplicate mutators must be deduplicated');
  assert.equal(omni.enemyHpMult, 1.58);
  assert.equal(omni.enemyDamageMult, 1.42);
  assert.equal(omni.enemySpeedMult, 1.20);
  assert.equal(omni.playerMaxHpMult, 0.75);
  assert.equal(omni.playerDamageMult, 1.38);
  assert.equal(omni.playerUltGainMult, 1.20);
  assert.equal(omni.waveHealMult, 0.5);
  assert.equal(omni.vampiricKillHeal, 14);
  assert.equal(omni.propCooldownScale, 0.5);
  assert.equal(omni.propDamageMult, 1.35);
  assert.equal(omni.scoreMultiplier, 2.95);
});

test('Phase 4: Persistent CareerStore tracks 36-entry Codex (20 talents + 6 synergies + 10 hostiles), Hero Mastery & Rank progression', () => {
  const storage = createMemoryStorage();
  const store = createCareerStore(storage);

  assert.equal(store.getRankInfo().title, '初阵门生');
  assert.equal(store.getCodexProgress().totalEntries, 36);
  assert.equal(store.getCodexProgress().totalUnlocked, 0);

  // Unlock all 20 talents, 6 Tier-II synergies, and 10 hostile entries
  for (const card of UPGRADE_CATALOG) {
    assert.equal(store.recordTalentPick(card.id), true);
    assert.equal(store.recordTalentPick(card.id), false, 'Second pick must not re-flag first discovery');
  }
  const synTiers = {} as Record<SynergyPairId, SynergyTier>;
  for (const syn of SYNERGY_CATALOG) {
    synTiers[syn.id] = 2;
  }
  assert.equal(store.recordSynergies(synTiers), true);
  for (const h of HOSTILE_CODEX_SPECS) {
    assert.equal(store.recordHostileDefeat(h.id), true);
  }

  const fullCodex = store.getCodexProgress();
  assert.equal(fullCodex.talentsUnlocked, 20);
  assert.equal(fullCodex.synergiesUnlocked, 6);
  assert.equal(fullCodex.synergiesTier2, 6);
  assert.equal(fullCodex.hostilesUnlocked, 10);
  assert.equal(fullCodex.totalUnlocked, 36);
  assert.equal(fullCodex.completionPct, 100);

  // Record a high-scoring Shura run and verify rank-up & reload persistence
  const outcome = store.recordRunCompleted({
    hero: 'hanzo',
    difficulty: 'shura',
    mutators: ['blood_moon', 'glass_cannon'],
    wave: 9,
    kills: 74,
    durationSec: 485,
    shots: 140,
    hits: 98,
    bossKills: 3,
    coreInterrupts: 2,
    parries: 0,
    propsTriggered: 6,
    synergyCount: 4,
    scoreMultiplier: 2.0,
  });
  assert.equal(outcome.isNewBestWave, true);
  assert.equal(outcome.isNewBestScore, true);
  assert.equal(outcome.rankUp, true);
  assert.ok(outcome.scoreSummary.finalScore >= 9500);
  assert.ok(outcome.nextRank.rankIndex >= 2);

  // Reload from serialized JSON in storage + verify corrupted JSON recovery
  const reloaded = createCareerStore(storage);
  assert.equal(reloaded.profile.highestWave, 9);
  assert.equal(reloaded.profile.heroStats.hanzo.bestWave, 9);
  assert.equal(reloaded.profile.heroStats.hanzo.kills, 74);
  assert.equal(reloaded.profile.recentRuns.length, 1);
  assert.equal(reloaded.getCodexProgress().completionPct, 100);
  assert.equal(computeCareerRank(13000).title, '花村武神');
  assert.equal(parseCareerProfile('{corrupted-json').totalRuns, 0);
  assert.ok(storage.raw.has(CAREER_STORAGE_KEY));
});

test('Phase 4: Procedural Wafu In-Sen Soundscape Scheduler & 8 Tactical/Counterplay Audio Cues step deterministically', () => {
  const audio = createGenjiAudio(true);

  // Trigger all 8 new tactical, synergy & counterplay cues
  audio.caskDetonate();
  audio.updraftLaunch();
  audio.gongRing();
  audio.synergyAwaken(1);
  audio.synergyAwaken(2);
  audio.thunderWarning();
  audio.coreInterrupt();
  audio.guardBreak();
  audio.rankUp();

  const d1 = audio.getDiagnostics();
  assert.equal(d1.cuesPlayed, 9);
  assert.equal(d1.bgmEnabled, true);
  assert.equal(d1.soundscapeMode, 'silent');

  // Silent mode emits 0 BGM notes
  for (let i = 0; i < 30; i++) audio.stepSoundscape(0.05);
  assert.equal(audio.getDiagnostics().bgmNotesPlayed, 0);

  // Title mode steps calm Shakuhachi/Furin motif
  audio.setSoundscapeState('title', 0.35);
  for (let i = 0; i < 50; i++) audio.stepSoundscape(0.05); // 2.5s
  const calmNotes = audio.getDiagnostics().bgmNotesPlayed;
  assert.ok(calmNotes >= 1 && calmNotes <= 3, `Expected slow calm cadence, got ${calmNotes}`);

  // Boss mode steps rapid war-taiko / Koto cadence
  audio.setSoundscapeState('boss', 1.0);
  for (let i = 0; i < 50; i++) audio.stepSoundscape(0.05); // +2.5s
  const bossNotes = audio.getDiagnostics().bgmNotesPlayed - calmNotes;
  assert.ok(bossNotes >= 8, `Expected urgent boss cadence > calm cadence, got ${bossNotes}`);

  // Disabling BGM halts note scheduling immediately
  audio.setBgmEnabled(false);
  const frozenNotes = audio.getDiagnostics().bgmNotesPlayed;
  for (let i = 0; i < 30; i++) audio.stepSoundscape(0.05);
  assert.equal(audio.getDiagnostics().bgmNotesPlayed, frozenNotes);
});

test('Phase 4: Integrated GenjiRoguelikeMode wires Title Challenge UI, Codex Tab, Mutator combat effects & Death career settlement', () => {
  const uiEl = document.getElementById('ui') || document.body;
  uiEl.innerHTML = '';
  const hudRoot = document.createElement('div');
  hudRoot.innerHTML =
    '<div class="h-obj"><div class="h-obj-t"></div></div><div class="h-health"></div><div class="h-wname"></div><div class="h-ammo-r"></div>';
  uiEl.appendChild(hudRoot);

  const storage = createMemoryStorage();
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
    __careerStorage: storage,
    params: { noaudio: '1' },
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
      health: 200,
      maxHealth: 200,
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
      stats: { shots: 20, hits: 14, kills: 0 },
      reset() {
        this.stats.shots = 20;
        this.stats.hits = 14;
      },
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
      visible: false,
      show(v: boolean) {
        this.visible = Boolean(v);
      },
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

  const fullMockMenuFactory = (_g: any, handlers: any) => {
    const mRoot = document.createElement('div');
    mRoot.className = 'menu';
    mRoot.innerHTML = `
      <section class="m-screen m-title" data-s="title">
        <div class="m-title-main">
          <div class="m-hero-picker">
            <button data-hero-pick="genji" class="active" aria-pressed="true"></button>
            <button data-hero-pick="hanzo" aria-pressed="false"></button>
            <button data-hero-pick="gunner" aria-pressed="false"></button>
          </div>
          <div class="m-actions">
            <button class="btn primary" data-act="deploy"></button>
          </div>
        </div>
      </section>
      <section class="m-screen" data-s="paused"><div class="m-actions"></div></section>
      <section class="m-screen m-dead" data-s="dead">
        <dl class="m-stats"><dd data-f="dead-time"></dd><dd data-f="dead-relays"></dd></dl>
      </section>
      <div class="panel" hidden>
        <div class="tabs">
          <button class="tab" data-tab="settings" aria-selected="true">设置</button>
        </div>
        <div class="panel-b" data-pane="settings"><p class="panel-note"></p></div>
      </div>
    `;
    mRoot.addEventListener('click', (ev: any) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;
      if (btn.dataset.tab) {
        mRoot.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
          t.setAttribute('aria-selected', String(t.dataset.tab === btn.dataset.tab));
        });
        mRoot.querySelectorAll<HTMLElement>('.panel-b').forEach((p) => {
          p.hidden = p.dataset.pane !== btn.dataset.tab;
        });
      }
      if (btn.dataset.act && handlers[btn.dataset.act]) {
        handlers[btn.dataset.act]();
      }
    });
    uiEl.appendChild(mRoot);
    let scr = 'title';
    return {
      root: mRoot,
      handlers,
      settings: { fov: 75, volume: 0.8 },
      get screen() {
        return scr;
      },
      get panelOpen() {
        const p = mRoot.querySelector('.panel') as HTMLElement | null;
        return !!(p && !p.hidden);
      },
      closePanel: () => {
        const p = mRoot.querySelector('.panel') as HTMLElement | null;
        if (!p || p.hidden) return false;
        p.hidden = true;
        return true;
      },
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

  const game = installGenjiRoguelikeMode(mockG, fullMockMenuFactory);

  // Verify Title Career Banner, Challenge Box, and Codex Panel were injected cleanly
  assert.ok(uiEl.querySelector('.m-career-bar'), 'Expected .m-career-bar on Title screen');
  assert.ok(uiEl.querySelector('.m-challenge-box'), 'Expected .m-challenge-box on Title screen');
  assert.ok(uiEl.querySelector('[data-act="codex"]'), 'Expected Codex button in Title actions');
  assert.ok(uiEl.querySelector('[data-perf="off"]'), 'Expected Perf HUD toggle in Settings pane');

  game.openCodex();
  const codexPane = uiEl.querySelector('.m-codex-pane') as HTMLElement | null;
  assert.ok(codexPane && !codexPane.hidden, 'openCodex() must reveal .m-codex-pane');
  game.menus.closePanel();

  // Select Shura difficulty + glass_cannon + blood_moon + volatile_arena via UI / API
  game.setChallenge('shura', ['glass_cannon', 'blood_moon', 'volatile_arena']);
  assert.equal(game.challenge.scoreMultiplier, 2.2);

  game.start({ skipIntro: true });
  assert.equal(mockG.hud.visible, true, 'Gameplay HUD must be visible during active run');
  assert.equal(mockG.player.maxHealth, 150, 'glass_cannon must scale Genji base 200 HP to 150 HP');
  assert.ok(mockG.getTacticalDamageMultiplier() >= 1.38, 'glass_cannon must boost player damage by +38%');
  assert.ok(uiEl.querySelector('.g-chip.g-chip-chal'), 'Active Shura challenge must display .g-chip-chal in HUD');

  // Pausing must hide background gameplay HUD, and resuming must restore it
  game.pause();
  assert.equal(mockG.hud.visible, false, 'Pause must hide background gameplay HUD');
  game.resume();
  assert.equal(mockG.hud.visible, true, 'Resume must restore gameplay HUD');

  // Verify blood_moon vampiric kill heal (+14 HP) & hostile Codex discovery
  mockG.player.health = 100;
  events.emit('enemy:killed', { enemy: { __variant: 'shield_guard', type: 'trooper' } });
  assert.equal(mockG.player.health, 114, 'blood_moon must heal +14 HP on enemy elimination');
  assert.equal(game.career.profile.defeatedHostiles['shield_guard'], 1);

  // Draft a talent & verify Codex talent unlock
  game.openDraftForTest();
  game.chooseUpgradeForTest(0);
  assert.equal(game.career.getCodexProgress().talentsUnlocked, 1);

  // Trigger player:dead -> settles run into CareerStore and renders .m-dead-summary
  events.emit('player:dead', {});
  assert.equal(game.state, 'dead');
  assert.equal(mockG.hud.visible, false, 'Death settlement must hide background gameplay HUD');
  assert.equal(game.career.profile.totalRuns, 1);
  assert.equal(game.career.profile.highestWave, game.run.wave);
  assert.ok(game.career.profile.honorPoints >= 25);
  const deadSummary = uiEl.querySelector('.m-dead-summary');
  assert.ok(deadSummary && deadSummary.textContent?.includes('获赐武勋'));
});

test('Mobile UI & iOS Chrome Adaptation: Perf HUD auto-collapse on touch viewports & visibility toggle', () => {
  assert.equal(
    shouldAutoCollapsePerfHud({
      coarsePointer: true,
      maxTouchPoints: 5,
      viewportWidth: 844,
      viewportHeight: 315,
    }),
    true
  );
  assert.equal(
    shouldAutoCollapsePerfHud({
      coarsePointer: false,
      maxTouchPoints: 0,
      viewportWidth: 1440,
      viewportHeight: 900,
    }),
    false
  );

  let appEl = document.getElementById('app');
  if (!appEl) {
    appEl = document.createElement('div');
    appEl.id = 'app';
    document.body.appendChild(appEl);
  }
  const hud = createPerfHud({});
  const el = document.getElementById('perf-hud') as HTMLElement | null;
  assert.ok(el, 'Expected #perf-hud mounted');
  assert.equal(hud.visible, true);
  assert.equal(el.hidden, false);

  hud.setVisible(false);
  assert.equal(hud.visible, false);
  assert.equal(el.hidden, true);

  hud.setVisible(true);
  assert.equal(hud.visible, true);
  assert.equal(el.hidden, false);
  hud.dispose();
});
