import './headlessDomShim.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ENTITY_INDEX_MASK, World, entityGeneration } from '../engine/ecs/index.ts';
import {
  CombatHealth,
  CombatTransform,
  CombatVelocity,
  EnemyHitbox,
  PROJECTILE_KIND,
  ProjectileFlight,
  createEcsCombatBridge,
  type EnemyActorLike,
  type EnemyRaycastHit,
  type Vec3Like,
} from './ecsCombatBridge.ts';
import { createPerfHud, type PerfHudPhaseInput } from './perfHud.ts';
import {
  createSpatialArenaPhysics,
  type ArenaBoundsSpec,
} from './spatialPhysicsAdapter.ts';

const HANAMURA_BOUNDS: ArenaBoundsSpec = {
  min: new THREE.Vector3(-94, -8, -86),
  max: new THREE.Vector3(94, 48, 86),
  groundY: 0,
  seaY: -2.2,
  quayX: 90,
};

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createEventHub() {
  const listeners = new Map<string, Array<(payload?: any) => void>>();
  return {
    on(event: string, fn: (payload?: any) => void) {
      let arr = listeners.get(event);
      if (!arr) {
        arr = [];
        listeners.set(event, arr);
      }
      arr.push(fn);
    },
    emit(event: string, payload?: any) {
      const arr = listeners.get(event);
      if (!arr) return;
      for (let i = 0; i < arr.length; i++) {
        arr[i](payload);
      }
    },
  };
}

function intersectSphere(
  origin: Vec3Like,
  dir: Vec3Like,
  center: Vec3Like,
  radius: number,
  maxDist: number,
  hit: EnemyRaycastHit,
): boolean {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const a = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > maxDist || t >= hit.dist) return false;
  hit.dist = t;
  hit.point.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
  hit.normal
    .set(hit.point.x - center.x, hit.point.y - center.y, hit.point.z - center.z)
    .normalize();
  return true;
}

function createMockEnemy(
  id: number,
  type: 'trooper' | 'hound' | 'gull',
  x: number,
  y: number,
  z: number,
  hitR2 = 2.6,
): EnemyActorLike {
  const pos = new THREE.Vector3(x, y, z);
  const vel = new THREE.Vector3(0.5, 0, -0.4);
  const headCenter = new THREE.Vector3();
  const bodyCenter = new THREE.Vector3();
  const actor: EnemyActorLike = {
    id,
    type,
    pos,
    vel,
    hp: type === 'gull' ? 45 : 140,
    maxHp: type === 'gull' ? 45 : 140,
    alive: true,
    active: true,
    __hitR2: hitR2,
    _raycast(origin, dir, maxDist, hit) {
      let matched = false;
      if (type === 'trooper') {
        headCenter.set(pos.x, pos.y + 1.52, pos.z);
        if (intersectSphere(origin, dir, headCenter, 0.18, maxDist, hit)) {
          hit.part = 'weak';
          hit.enemy = actor;
          matched = true;
        }
        bodyCenter.set(pos.x, pos.y + 0.85, pos.z);
        if (intersectSphere(origin, dir, bodyCenter, 0.34, maxDist, hit)) {
          hit.part = 'body';
          hit.enemy = actor;
          matched = true;
        }
      } else if (type === 'hound') {
        bodyCenter.set(pos.x, pos.y + 0.6, pos.z);
        if (intersectSphere(origin, dir, bodyCenter, 0.42, maxDist, hit)) {
          hit.part = 'body';
          hit.enemy = actor;
          matched = true;
        }
      } else {
        bodyCenter.set(pos.x, pos.y, pos.z);
        if (intersectSphere(origin, dir, bodyCenter, 0.46, maxDist, hit)) {
          hit.part = 'body';
          hit.enemy = actor;
          matched = true;
        }
      }
      return matched;
    },
  };
  return actor;
}

test('EcsCombatBridge manages generational EntityIds, SoA columns, projectile pools, and zero-leak wave resets', () => {
  const events = createEventHub();
  const enemyList: EnemyActorLike[] = [];
  const G: Record<string, any> = {
    events,
    time: { frame: 1 },
    enemies: { list: enemyList },
  };

  const bridge = createEcsCombatBridge(G, new World({ maxEntities: 64 }));
  const world = bridge.world;

  const bolts = Array.from({ length: 16 }, () => ({
    on: false,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, 1),
    life: 2.0,
  }));
  const shurikens = Array.from({ length: 12 }, () => ({
    active: false,
    impactResolved: false,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, -1),
    speed: 96,
    damage: 34,
    life: 1.2,
  }));

  bridge.registerProjectilePool({
    name: 'enemy_bolts',
    kind: PROJECTILE_KIND.ENEMY_BOLT,
    faction: 1,
    items: bolts,
    isActive: (b) => b.on,
    getSpeed: () => 54,
    getDamage: () => 9,
  });
  bridge.registerProjectilePool({
    name: 'genji_shurikens',
    kind: PROJECTILE_KIND.GENJI_SHURIKEN,
    faction: 0,
    items: shurikens,
    isActive: (s) => s.active && !s.impactResolved,
  });

  // Spawn 6 pooled enemies and activate 5 bolts + 4 shurikens
  const poolActors = [
    createMockEnemy(1, 'trooper', -8, 0, -12, 2.6),
    createMockEnemy(2, 'trooper', 6, 0, -15, 8.4), // Boss __hitR2
    createMockEnemy(3, 'hound', -4, 0, 8, 4.2),
    createMockEnemy(4, 'hound', 12, 0, 5, 4.6),
    createMockEnemy(5, 'gull', 0, 6.5, -18, 2.6),
    createMockEnemy(6, 'gull', -14, 5.2, 4, 2.6),
  ];
  for (const en of poolActors) {
    enemyList.push(en);
    bridge.onEnemySpawn(en);
  }

  for (let i = 0; i < 5; i++) {
    bolts[i].on = true;
    bolts[i].pos.set(i * 2, 1.5, -4);
  }
  for (let i = 0; i < 4; i++) {
    shurikens[i].active = true;
    shurikens[i].pos.set(-3 + i, 1.6, -6);
  }

  G.time.frame++;
  bridge.syncAll();

  assert.equal(bridge.telemetry.enemyEntities, 6);
  assert.equal(bridge.telemetry.projectileEntities, 9);
  assert.equal(bridge.telemetry.activeEntities, 15);
  assert.equal(world.aliveCount, 15);

  // Verify SoA columns match live enemy & projectile state
  const eid0 = bridge.entityOfEnemy(poolActors[0]);
  const slot0 = eid0 & ENTITY_INDEX_MASK;
  const tfCols = world.getStore(CombatTransform);
  const hbCols = world.getStore(EnemyHitbox);
  const hpCols = world.getStore(CombatHealth);
  const vfCols = world.getStore(CombatVelocity);
  const pfCols = world.getStore(ProjectileFlight);

  assert.equal(tfCols.x[slot0], -8);
  assert.equal(tfCols.z[slot0], -12);
  assert.equal(hbCols.enemyId[slot0], 1);
  assert.equal(hpCols.hp[slot0], 140);
  assert.ok(vfCols.speed[slot0] > 0.6);

  // Check projectile SoA store populated
  let shurikenFound = 0;
  bridge.projectileQuery.forEach((slot) => {
    if (pfCols.kind[slot] === PROJECTILE_KIND.GENJI_SHURIKEN) {
      shurikenFound++;
      assert.equal(pfCols.damage[slot], 34);
      assert.equal(Math.round(vfCols.speed[slot]), 96);
    }
  });
  assert.equal(shurikenFound, 4);

  // Emit damage events via G.events and verify CombatDamageEvent ring buffer
  poolActors[0].hp = 72;
  events.emit('enemy:hit', { enemy: poolActors[0], part: 'weak', damage: 68 });
  assert.equal(bridge.damageEvents.length, 1);
  assert.equal(bridge.telemetry.damageEventsTotal, 1);
  assert.equal(hpCols.hp[slot0], 72);
  bridge.tickTelemetryWindow(0.6);
  assert.ok(bridge.telemetry.damageEventsPerSec > 0);

  // Stress 20 wave cycles reusing the pooled actors: generation advances, 0 leaked entities or spatial slots
  const firstGen = entityGeneration(eid0);
  const initialGridItems = bridge.dynamicGrid.itemCount;

  for (let wave = 0; wave < 20; wave++) {
    bridge.onClear();
    enemyList.length = 0;
    for (const b of bolts) b.on = false;
    for (const s of shurikens) s.active = false;
    assert.equal(world.aliveCount, 0);

    for (let i = 0; i < poolActors.length; i++) {
      const en = poolActors[i];
      en.id = wave * 10 + i + 1;
      en.alive = true;
      en.active = true;
      en.hp = 140;
      en.pos.x = -20 + i * 7 + (wave % 3);
      en.pos.z = -15 + i * 5;
      enemyList.push(en);
      bridge.onEnemySpawn(en);
    }
    bolts[wave % bolts.length].on = true;
    shurikens[wave % shurikens.length].active = true;
    G.time.frame++;
    bridge.syncAll();
    assert.equal(world.aliveCount, 8);
  }

  const finalEid0 = bridge.entityOfEnemy(poolActors[0]);
  assert.ok(
    entityGeneration(finalEid0) > firstGen,
    'Expected recycled EntityId generation to advance across wave resets',
  );
  assert.equal(
    bridge.dynamicGrid.itemCount,
    initialGridItems,
    'Pooled enemy actors must reuse persistent dynamic SpatialHashGrid slots with zero growth',
  );
});

test('EcsCombatBridge achieves 100% raycastEnemies & queryEnemiesInSphere parity vs Legacy O(N)', () => {
  const rng = mulberry32(20261119);
  const enemyList: EnemyActorLike[] = [];
  const G: Record<string, any> = {
    time: { frame: 1 },
    enemies: { list: enemyList },
  };
  const bridge = createEcsCombatBridge(G);

  const types: Array<'trooper' | 'hound' | 'gull'> = ['trooper', 'hound', 'gull'];
  const hitRadii = [2.6, 3.6, 4.2, 4.6, 8.4];

  for (let i = 0; i < 60; i++) {
    const t = types[i % 3];
    const x = -56 + rng() * 112;
    const z = -52 + rng() * 104;
    const y = t === 'gull' ? 3.5 + rng() * 6.0 : rng() < 0.25 ? 3.2 : 0;
    const hitR2 = hitRadii[i % hitRadii.length];
    const en = createMockEnemy(i + 1, t, x, y, z, hitR2);
    if (i % 11 === 0) {
      en.alive = false; // Mix in dead enemies to verify alive filtering
    }
    enemyList.push(en);
  }

  G.time.frame++;
  bridge.syncEnemies();

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();

  // 1. 400 short-step projectile rays + 250 long-range hitscan/deflect rays (up to 300m) + direct aimed rays
  for (let i = 0; i < 650; i++) {
    if (i < 60 && enemyList[i].alive) {
      // Aim directly at each alive enemy (alternating head weakspot & body) from random standoff
      const target = enemyList[i];
      const aimY =
        target.type === 'trooper'
          ? target.pos.y + (i % 2 === 0 ? 1.52 : 0.85)
          : target.type === 'hound'
            ? target.pos.y + 0.6
            : target.pos.y;
      const ang = rng() * Math.PI * 2;
      const dist = 3 + rng() * 65;
      origin.set(
        target.pos.x + Math.cos(ang) * dist,
        aimY + (rng() - 0.5) * 1.2,
        target.pos.z + Math.sin(ang) * dist,
      );
      dir
        .set(target.pos.x - origin.x, aimY - origin.y, target.pos.z - origin.z)
        .normalize();
    } else {
      origin.set(-62 + rng() * 124, 0.5 + rng() * 8.0, -58 + rng() * 116);
      dir.set(rng() * 2 - 1, (rng() - 0.5) * 0.7, rng() * 2 - 1).normalize();
    }

    const maxDist = i < 400 ? 0.8 + rng() * 12.0 : 25.0 + rng() * 275.0;

    bridge.telemetry.setSpatialAccelerated(true);
    const sHitRaw = bridge.raycastEnemies(origin, dir, maxDist);
    const sSnap = sHitRaw
      ? {
          id: sHitRaw.enemy.id,
          part: sHitRaw.part,
          dist: sHitRaw.dist,
          pt: sHitRaw.point.clone(),
          nrm: sHitRaw.normal.clone(),
        }
      : null;

    bridge.telemetry.setSpatialAccelerated(false);
    const lHitRaw = bridge.raycastEnemies(origin, dir, maxDist);
    const lSnap = lHitRaw
      ? {
          id: lHitRaw.enemy.id,
          part: lHitRaw.part,
          dist: lHitRaw.dist,
          pt: lHitRaw.point.clone(),
          nrm: lHitRaw.normal.clone(),
        }
      : null;

    assert.equal(
      Boolean(sSnap),
      Boolean(lSnap),
      `Ray #${i} (maxDist=${maxDist.toFixed(2)}) hit mismatch: spatial=${sSnap?.id ?? null} vs legacy=${lSnap?.id ?? null}`,
    );
    if (sSnap && lSnap) {
      assert.equal(sSnap.id, lSnap.id, `Ray #${i} enemy id mismatch`);
      assert.equal(sSnap.part, lSnap.part, `Ray #${i} part mismatch`);
      assert.ok(Math.abs(sSnap.dist - lSnap.dist) < 1e-6, `Ray #${i} dist mismatch`);
      assert.ok(sSnap.pt.distanceTo(lSnap.pt) < 1e-5, `Ray #${i} point mismatch`);
      assert.ok(sSnap.nrm.distanceTo(lSnap.nrm) < 1e-5, `Ray #${i} normal mismatch`);
    }
  }

  // 2. 200 AoE sphere / separation / ricochet / homing queries: verify Spatial candidate set is a 100% superset of true sphere hits
  const candSpatial: EnemyActorLike[] = [];
  const candLegacy: EnemyActorLike[] = [];
  for (let q = 0; q < 200; q++) {
    const cx = -55 + rng() * 110;
    const cy = rng() * 6.0;
    const cz = -50 + rng() * 100;
    const radius = q % 3 === 0 ? 1.35 : q % 3 === 1 ? 4.8 : 26.5;
    const ignoreY = q % 4 === 0;

    bridge.telemetry.setSpatialAccelerated(true);
    bridge.queryEnemiesInSphere(cx, cy, cz, radius, candSpatial, { ignoreY });

    bridge.telemetry.setSpatialAccelerated(false);
    bridge.queryEnemiesInSphere(cx, cy, cz, radius, candLegacy, { ignoreY });

    const narrowHitsSpatial: number[] = [];
    for (const en of candSpatial) {
      const dx = en.pos.x - cx;
      const dy = ignoreY ? 0 : en.pos.y + 0.9 - cy;
      const dz = en.pos.z - cz;
      if (dx * dx + dy * dy + dz * dz <= radius * radius) {
        narrowHitsSpatial.push(en.id);
      }
    }

    const narrowHitsLegacy: number[] = [];
    for (const en of candLegacy) {
      const dx = en.pos.x - cx;
      const dy = ignoreY ? 0 : en.pos.y + 0.9 - cy;
      const dz = en.pos.z - cz;
      if (dx * dx + dy * dy + dz * dz <= radius * radius) {
        narrowHitsLegacy.push(en.id);
      }
    }

    assert.deepEqual(
      narrowHitsSpatial,
      narrowHitsLegacy,
      `AoE Sphere #${q} (r=${radius}, ignoreY=${ignoreY}) mismatch`,
    );
  }

  bridge.telemetry.setSpatialAccelerated(true);
});

test('EcsCombatBridge accelerates high-density projectile & separation queries (>3.5x speedup) and syncs with PerfHUD F4', () => {
  const rng = mulberry32(9001);
  const phys = createSpatialArenaPhysics({}, HANAMURA_BOUNDS);
  phys.build();

  const enemyList: EnemyActorLike[] = [];
  const G: Record<string, any> = {
    physics: phys,
    quality: { name: 'high' },
    time: { frame: 1 },
    enemies: {
      list: enemyList,
      aliveCount: () => enemyList.length,
    },
    render: { stats: () => ({ calls: 142, tris: 58400, scale: 1 }) },
  };

  const bridge = createEcsCombatBridge(G);
  G.ecsCombat = bridge;

  // Populate 180 spread-out dynamic enemies across the 192m x 192m arena
  for (let i = 0; i < 180; i++) {
    const en = createMockEnemy(
      i + 1,
      i % 3 === 0 ? 'trooper' : i % 3 === 1 ? 'hound' : 'gull',
      -84 + rng() * 168,
      i % 3 === 2 ? 5.0 : 0,
      -80 + rng() * 160,
    );
    enemyList.push(en);
    bridge.onEnemySpawn(en);
  }

  const bolts = Array.from({ length: 40 }, (_, i) => ({
    on: true,
    pos: new THREE.Vector3(-40 + i * 2, 1.4, -20),
    dir: new THREE.Vector3(0, 0, 1),
    life: 2.0,
  }));
  bridge.registerProjectilePool({
    name: 'bench_bolts',
    kind: PROJECTILE_KIND.ENEMY_BOLT,
    faction: 1,
    items: bolts,
    isActive: (b) => b.on,
    getSpeed: () => 54,
    getDamage: () => 9,
  });

  const stepRays = Array.from({ length: 160 }, () => ({
    o: new THREE.Vector3(-75 + rng() * 150, 1.4, -75 + rng() * 150),
    d: new THREE.Vector3(rng() * 2 - 1, (rng() - 0.5) * 0.2, rng() * 2 - 1).normalize(),
  }));

  const sepCand: EnemyActorLike[] = [];
  bridge.telemetry.setTimingEnabled(false);

  const runCombatBatch = (accelerated: boolean, frames: number): number => {
    bridge.telemetry.setSpatialAccelerated(accelerated);
    G.time.frame++;
    bridge.syncAll();
    let pushSink = 0;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      bridge.telemetry.resetFrameCounters();
      for (let r = 0; r < stepRays.length; r++) {
        bridge.raycastEnemies(stepRays[r].o, stepRays[r].d, 3.2);
      }
      for (let s = 0; s < enemyList.length; s++) {
        const actor = enemyList[s];
        bridge.queryEnemiesInSphere(
          actor.pos.x,
          actor.pos.y,
          actor.pos.z,
          1.35,
          sepCand,
          { ignoreY: true, skipAutoSync: true },
        );
        for (let k = 0; k < sepCand.length; k++) {
          const other = sepCand[k];
          if (other === actor || !other.alive) continue;
          const dx = actor.pos.x - other.pos.x;
          const dz = actor.pos.z - other.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 1.2 && d2 > 1e-4) {
            pushSink += dx * (1.1 - Math.sqrt(d2));
          }
        }
      }
    }
    if (pushSink === 1e99) console.log(pushSink);
    return (performance.now() - t0) / frames;
  };

  // JIT warmup
  runCombatBatch(true, 12);
  runCombatBatch(false, 12);

  let spatialMs = Infinity;
  let legacyMs = Infinity;
  for (let round = 0; round < 5; round++) {
    const sMs = runCombatBatch(true, 16);
    const lMs = runCombatBatch(false, 16);
    if (sMs < spatialMs) spatialMs = sMs;
    if (lMs < legacyMs) legacyMs = lMs;
  }
  const speedup = legacyMs / Math.max(0.001, spatialMs);
  console.log(
    `[bench:ecsCombat] 180 enemies + 160 rays + 180 sep: Spatial=${spatialMs.toFixed(3)}ms/f vs Legacy=${legacyMs.toFixed(3)}ms/f (${speedup.toFixed(2)}x speedup)`,
  );

  assert.ok(
    speedup > 3.5,
    `Expected >3.5x dynamic combat spatial speedup, got ${speedup.toFixed(2)}x (spatial=${spatialMs.toFixed(3)}ms, legacy=${legacyMs.toFixed(3)}ms)`,
  );

  // Verify timing probe & call counters when timingEnabled = true
  bridge.telemetry.setTimingEnabled(true);
  bridge.telemetry.resetFrameCounters();
  bridge.raycastEnemies(stepRays[0].o, stepRays[0].d, 8.0);
  bridge.queryEnemiesInSphere(0, 0, 0, 12.0, sepCand);
  assert.equal(bridge.telemetry.enemyRaycastCalls, 1);
  assert.equal(bridge.telemetry.aoeQueryCalls, 1);
  assert.ok(bridge.telemetry.combatMsAcc > 0);

  // Verify shared World + F4 lockstep toggle + live ECS entity count in PerfHUD DOM
  const hud = createPerfHud(G);
  assert.equal(hud.world, bridge.world, 'PerfHUD and EcsCombatBridge must share the same World');

  const phaseIn: PerfHudPhaseInput = {
    dt: 1 / 60,
    rawFrameSec: 1 / 60,
    runInput: () => {},
    runGameplayAndPlayer: () => {},
    runWeapon: () => {},
    runEnemies: () => {},
    runWorldAndAudioHud: () => {},
    runRender: () => {},
  };

  for (let i = 0; i < 14; i++) {
    G.time.frame++;
    bridge.raycastEnemies(stepRays[0].o, stepRays[0].d, 5);
    hud.stepFrame(phaseIn);
  }

  const hudEl = document.getElementById('perf-hud')!;
  assert.ok(
    hudEl.textContent.includes('ECS: 220 ent (180敌 · 40弹)'),
    `Expected live ECS entity breakdown in PerfHUD, got: ${hudEl.textContent}`,
  );

  // F4 toggles both static physics AND dynamic ECS combat acceleration
  window.dispatchEvent({
    type: 'keydown',
    code: 'F4',
    repeat: false,
  } as unknown as KeyboardEvent);
  assert.equal(phys.telemetry.spatialAccelerated, false);
  assert.equal(bridge.telemetry.spatialAccelerated, false);

  window.dispatchEvent({
    type: 'keydown',
    code: 'F4',
    repeat: false,
  } as unknown as KeyboardEvent);
  assert.equal(phys.telemetry.spatialAccelerated, true);
  assert.equal(bridge.telemetry.spatialAccelerated, true);

  hud.dispose();
});
