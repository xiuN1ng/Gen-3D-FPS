import './headlessDomShim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  computeHitstopDilation,
  createCombatFeelVfx,
} from './combatFeelVfx.ts';
import { createEcsCombatBridge } from './ecsCombatBridge.ts';
import { createGenjiWeapon } from './genjiWeapon.ts';
import { createGunnerWeapon } from './gunnerWeapon.ts';
import { createHanzoWeapon } from './hanzoWeapon.ts';
import { createPerfHud } from './perfHud.ts';
import {
  createBaseGenjiStats,
  createBaseGunnerStats,
  createBaseHanzoStats,
} from './roguelike.ts';

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
    },
  );
}

test('computeHitstopDilation holds 0.08x impact freeze then smoothly ramps recovery tail', () => {
  const total = 0.05;
  assert.equal(computeHitstopDilation(0, total), 1.0);
  assert.equal(computeHitstopDilation(-0.01, total), 1.0);

  // Opening 65% of window holds crisp 0.08x freeze
  assert.equal(computeHitstopDilation(0.05, total), 0.08);
  assert.equal(computeHitstopDilation(0.03, total), 0.08);
  assert.equal(computeHitstopDilation(0.018, total), 0.08);

  // Recovery tail (remaining < 35% of total) ramps smoothly and monotonically toward 0.86x
  const rMid = computeHitstopDilation(0.01, total);
  const rLate = computeHitstopDilation(0.003, total);
  const rEnd = computeHitstopDilation(0.0001, total);

  assert.ok(rMid > 0.08 && rMid < rLate, `Expected monotonic ramp: 0.08 < ${rMid} < ${rLate}`);
  assert.ok(rLate < rEnd && rEnd <= 0.861, `Expected tail end <= 0.86, got ${rEnd}`);
});

test('createCombatFeelVfx packs GPU-instanced flares, streaks, and enemy coronas with ring wrap-around & clean decay', () => {
  const events = createMockEventBus();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
  let lightFlashes = 0;

  const G: Record<string, any> = {
    THREE,
    scene,
    camera,
    events,
    player: {
      forward: new THREE.Vector3(0, 0, -1),
    },
    render: {
      lightPool: {
        flash() {
          lightFlashes++;
        },
      },
    },
  };

  const vfx = createCombatFeelVfx(G);
  assert.equal(vfx.critFlareMesh.count, 0);
  assert.equal(vfx.critFlareMesh.visible, false);
  assert.equal(vfx.hitStreakMesh.count, 0);
  assert.equal(vfx.hitCoronaMesh.count, 0);

  const mockEnemy = {
    id: 1,
    type: 'trooper',
    active: true,
    pos: new THREE.Vector3(2, 0, -8),
    headPos: new THREE.Vector3(2, 1.55, -8),
  };

  // Emit weakspot hit via G.events -> populates all 3 GPU-instanced meshes & camera micro-roll
  events.emit('player:hitEnemy', {
    enemy: mockEnemy,
    part: 'weak',
    weak: true,
    killed: false,
  });

  vfx.update(1 / 120);
  const snap1 = vfx.sampleTelemetry();
  assert.equal(snap1.activeCritFlares, 1);
  assert.equal(snap1.activeHitStreaks, 10);
  assert.equal(snap1.activeHitCoronas, 1);
  assert.equal(snap1.weakspotConfirmCount, 1);
  assert.equal(vfx.critFlareMesh.visible, true);
  assert.equal(vfx.hitStreakMesh.visible, true);
  assert.equal(vfx.hitCoronaMesh.visible, true);
  assert.ok(lightFlashes >= 1);
  assert.notEqual(vfx.getCameraRollOffset(), 0, 'Expected tactile Z-roll impulse on weakspot hit');

  // Move enemy and ensure corona tracks enemy position without duplicating corona slot for same enemy
  mockEnemy.pos.set(4.5, 0, -9);
  events.emit('player:hitEnemy', {
    enemy: mockEnemy,
    part: 'head',
    weak: true,
    killed: true,
  });
  vfx.update(1 / 120);
  const snap2 = vfx.sampleTelemetry();
  assert.equal(snap2.activeCritFlares, 2);
  assert.equal(snap2.activeHitCoronas, 1, 'Same enemy must reuse its active hit-flash corona slot');
  assert.equal(snap2.killBurstCount, 1);

  const coronaMat = new THREE.Matrix4();
  const coronaPos = new THREE.Vector3();
  vfx.hitCoronaMesh.getMatrixAt(0, coronaMat);
  coronaPos.setFromMatrixPosition(coronaMat);
  assert.ok(Math.abs(coronaPos.x - 4.5) < 1e-4, 'Corona must follow live enemy x position');

  // Stress-test ring wrap-around beyond pool capacities (48 flares, 160 streaks, 32 coronas)
  for (let i = 0; i < 65; i++) {
    vfx.triggerImpact({
      point: { x: i * 0.2, y: 1.2, z: -6 },
      dir: { x: 0, y: 0, z: -1 },
      enemy: { id: 100 + i, type: 'hound', active: true, pos: new THREE.Vector3(i * 0.2, 0, -6) },
      weak: i % 2 === 0,
      killed: i % 3 === 0,
      heavy: true,
    });
  }
  vfx.update(1 / 120);
  const snapBurst = vfx.sampleTelemetry();
  assert.equal(snapBurst.activeCritFlares, 48, 'Crit flares must cap cleanly at ring capacity 48');
  assert.equal(snapBurst.activeHitStreaks, 160, 'Hit streaks must cap cleanly at ring capacity 160');
  assert.equal(snapBurst.activeHitCoronas, 32, 'Hit coronas must cap cleanly at ring capacity 32');
  assert.equal(snapBurst.instancedDrawCalls, 3, '240 active combat-feel instances must render in exactly 3 Draw Calls');
  assert.equal(snapBurst.savedDrawCalls, 240 - 3);

  // Advance 1.0s in 60Hz steps -> all transient instances expire cleanly to 0 Draw Calls & 0 camera roll
  for (let f = 0; f < 60; f++) {
    vfx.update(1 / 60);
  }
  const snapIdle = vfx.sampleTelemetry();
  assert.equal(snapIdle.activeCritFlares, 0);
  assert.equal(snapIdle.activeHitStreaks, 0);
  assert.equal(snapIdle.activeHitCoronas, 0);
  assert.equal(vfx.critFlareMesh.visible, false);
  assert.equal(vfx.hitStreakMesh.visible, false);
  assert.equal(vfx.hitCoronaMesh.visible, false);
  assert.equal(vfx.getCameraRollOffset(), 0);
  assert.ok(snapIdle.peakSavedDrawCalls >= 237);

  vfx.dispose();
});

test('All 3 hero weapon suites batch high-frequency projectiles & ultimates into GPU InstancedMeshes (>=370 scene meshes eliminated, >10x DrawCall compression)', () => {
  const events = createMockEventBus();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
  camera.position.set(0, 1.68, 8);
  camera.updateMatrixWorld(true);
  const viewCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 20);

  const G: Record<string, any> = {
    THREE,
    scene,
    camera,
    viewCamera,
    events,
    input: {
      fire: false,
      ads: false,
      sprint: false,
      look: { dx: 0, dy: 0 },
      lookDX: 0,
      lookDY: 0,
      pressed: () => false,
      down: () => false,
    },
    player: {
      alive: true,
      enabled: true,
      onGround: true,
      speed: 6,
      yaw: 0,
      pitch: 0,
      pos: new THREE.Vector3(0, 0, 8),
      vel: new THREE.Vector3(),
      eye: new THREE.Vector3(0, 1.68, 8),
      forward: new THREE.Vector3(0, 0, -1),
      heal() {},
      addShake() {},
    },
    physics: {
      raycast: () => null,
      lineOfSight: () => true,
      groundHeight: () => 0,
    },
    enemies: {
      list: [],
      raycast: () => null,
      aliveCount: () => 0,
    },
    combat: {
      stats: { shots: 0, hits: 0, kills: 0 },
    },
    render: {
      lightPool: { flash() {} },
    },
  };

  G.ecsCombat = createEcsCombatBridge(G);
  const combatVfx = createCombatFeelVfx(G);
  G.combatVfx = combatVfx;

  const genjiStats = createBaseGenjiStats();
  const gunnerStats = createBaseGunnerStats();
  const hanzoStats = createBaseHanzoStats();
  const silentAudio = createSilentAudioStub();

  let stormLeft = 5;
  const genjiWpn = createGenjiWeapon(G, {
    getStats: () => genjiStats,
    isDeflecting: () => false,
    isDragonblade: () => false,
    audio: silentAudio,
    onDamageDealt() {},
  });

  const gunnerWpn = createGunnerWeapon(G, {
    getStats: () => gunnerStats,
    isActive: () => true,
    isSprinting: () => false,
    onCancelSprint() {},
    isVisorActive: () => false,
    isInBioticField: () => false,
    tryConsumeHelixCooldown: () => true,
    audio: silentAudio,
    onDamageDealt() {},
  });

  const hanzoWpn = createHanzoWeapon(G, {
    getStats: () => hanzoStats,
    isActive: () => true,
    isStormActive: () => stormLeft > 0,
    getStormArrowsLeft: () => stormLeft,
    consumeStormArrow: () => {
      stormLeft = Math.max(0, stormLeft - 1);
    },
    hasSmartRicochet: () => true,
    hasStormSiphon: () => false,
    hasLightDrawMove: () => false,
    isSonicArmed: () => false,
    consumeSonicArmed() {},
    onSonicFieldDeployed() {},
    audio: silentAudio,
    onDamageDealt() {},
  });

  // 1. Verify permanent scene-graph & shader material reduction at rest
  const idleSnap = combatVfx.sampleTelemetry();
  assert.ok(
    idleSnap.eliminatedSceneMeshes >= 370,
    `Expected >= 370 permanent THREE.Mesh scene nodes eliminated, got ${idleSnap.eliminatedSceneMeshes}`,
  );
  assert.equal(
    idleSnap.eliminatedShaderMaterials,
    28,
    `Expected 28 duplicate ShaderMaterials consolidated (17 rings + 11 blasts), got ${idleSnap.eliminatedShaderMaterials}`,
  );
  assert.equal(idleSnap.instancedDrawCalls, 0, 'Idle instanced pools must issue 0 Draw Calls');

  // 2. Trigger simultaneous multi-hero combat burst:
  // - Genji: homing kunai + shockwave crescent waves + dash wind-vortex ribbons + parry burst
  genjiWpn.spawnHomingKunai(new THREE.Vector3(0, 1.5, 6), 6, 40);
  genjiWpn.spawnShockwaveSlash(95);
  genjiWpn.spawnShockwaveSlash(95);
  genjiWpn.spawnDashRibbon(new THREE.Vector3(0, 1, 8), new THREE.Vector3(0, 1, -4), true);
  genjiWpn.spawnDashRibbon(new THREE.Vector3(-2, 1, 8), new THREE.Vector3(2, 1, -4), false);
  genjiWpn.spawnParryBurst(new THREE.Vector3(0, 1.4, 3), true);

  // - Gunner: 2 Helix Rocket volleys (6 finned 6-part warheads = 36 legacy meshes -> 5 instanced DCs!)
  gunnerWpn.fireHelixVolley();
  gunnerWpn.fireHelixVolley();

  // - Hanzo: Dragonstrike ultimate arrow -> detonate against a near wall (0.15m < 0.367m/frame) so Twin Spirit Dragons erupt!
  G.physics.raycast = () => ({
    dist: 0.15,
    point: new THREE.Vector3(0, 1.5, 7.5),
    normal: new THREE.Vector3(0, 0, 1),
    surface: 'stone',
  });
  hanzoWpn.onCastDragonstrike();
  hanzoWpn.update(1 / 60);
  // Restore open arena so rockets & shurikens stay in flight
  G.physics.raycast = () => null;

  genjiWpn.update(1 / 60);
  gunnerWpn.update(1 / 60);
  hanzoWpn.update(1 / 60);
  combatVfx.triggerImpact({
    point: { x: 0, y: 1.5, z: 2 },
    dir: { x: 0, y: 0, z: -1 },
    weak: true,
    killed: true,
    heavy: true,
  });
  combatVfx.update(1 / 60);

  const combatSnap = combatVfx.sampleTelemetry();
  const compressionRatio = combatSnap.unbatchedDrawCalls / Math.max(1, combatSnap.instancedDrawCalls);
  console.log(
    `[bench:instancedVfx] active=${combatSnap.activeInstances} inst | unbatched=${combatSnap.unbatchedDrawCalls} DC -> instanced=${combatSnap.instancedDrawCalls} DC (saved=${combatSnap.savedDrawCalls} DC, ${compressionRatio.toFixed(2)}x compression, -${combatSnap.eliminatedSceneMeshes} scene Meshes)`,
  );
  assert.ok(
    combatSnap.activeInstances >= 80,
    `Expected >= 80 live GPU instances across weapons & dragons, got ${combatSnap.activeInstances}`,
  );
  assert.ok(
    combatSnap.savedDrawCalls >= 130,
    `Expected >= 130 Draw Calls saved in active combat volley, got ${combatSnap.savedDrawCalls} (unbatched=${combatSnap.unbatchedDrawCalls}, instanced=${combatSnap.instancedDrawCalls})`,
  );
  assert.ok(
    compressionRatio >= 7.5,
    `Expected >= 7.5x Draw Call compression ratio, got ${compressionRatio.toFixed(2)}x`,
  );

  // 3. Reset all weapons & VFX -> 0 active instances and 0 instanced Draw Calls
  genjiWpn.reset();
  gunnerWpn.reset();
  hanzoWpn.reset();
  combatVfx.reset();
  const afterReset = combatVfx.sampleTelemetry();
  assert.equal(afterReset.activeInstances, 0);
  assert.equal(afterReset.instancedDrawCalls, 0);

  combatVfx.dispose();
});

test('PerfHud displays real-time GPU DrawCall savings, active instances, and eliminated scene meshes', () => {
  const scene = new THREE.Scene();
  const G: Record<string, any> = {
    THREE,
    scene,
    quality: { name: 'high' },
    render: {
      stats: () => ({ calls: 42, tris: 68400, scale: 1.0 }),
    },
  };
  const combatVfx = createCombatFeelVfx(G);
  G.combatVfx = combatVfx;

  let mockRockets = 8;
  const dummyGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const dummyMat = new THREE.MeshBasicMaterial();
  const dummyInst = new THREE.InstancedMesh(dummyGeo, dummyMat, 16);
  dummyInst.count = mockRockets;

  combatVfx.registerBatch({
    name: 'test_rockets',
    meshes: [dummyInst],
    getActiveCount: () => mockRockets,
    legacyMeshesPerItem: 6,
    eliminatedSceneMeshes: 115,
  });

  const hud = createPerfHud(G);
  hud.stepFrame({
    dt: 1 / 60,
    rawFrameSec: 0.2, // >= TEXT_REFRESH_SEC (0.16s) triggers immediate DOM refresh
    runInput() {},
    runGameplayAndPlayer() {},
    runWeapon() {},
    runEnemies() {},
    runWorldAndAudioHud() {
      combatVfx.update(1 / 60);
    },
    runRender() {},
  });

  const hudEl = document.getElementById('perf-hud');
  assert.ok(hudEl !== null, 'Expected #perf-hud overlay mounted in DOM');
  const text = hudEl?.textContent || '';
  assert.match(text, /DC:\s*42\s*\(-47批/);
  assert.match(text, /Inst:\s*8实\s*\(1批\)/);
  assert.match(text, /精简\s*-115\s*Mesh/);

  mockRockets = 0;
  dummyInst.count = 0;
  hud.dispose();
  combatVfx.dispose();
  dummyGeo.dispose();
  dummyMat.dispose();
});
