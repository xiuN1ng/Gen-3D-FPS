import './headlessDomShim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getHeadlessEnginePrimitives } from './engine.ts';
import { createPerfHud, type PerfHudPhaseInput } from './perfHud.ts';
import {
  createSpatialArenaPhysics,
  type ArenaBoundsSpec,
  type SpatialArenaPhysics,
} from './spatialPhysicsAdapter.ts';

const HANAMURA_BOUNDS: ArenaBoundsSpec = {
  min: new THREE.Vector3(-40, -6, -32),
  max: new THREE.Vector3(42, 30, 30),
  groundY: 0,
  seaY: -1.35,
  quayX: 30,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function populateHanamuraScaleColliders(physics: SpatialArenaPhysics, seed = 4207): void {
  const rng = mulberry32(seed);
  const surfaces = ['concrete', 'wood', 'metal', 'stone', 'dirt'];

  // Explicit edge-case boxes: exact float64 decimal boundaries, stairs, ceiling, air-wall, bulletOnly
  physics.addBox([1.0, 0, 1.0], [1.3, 1.65, 2.3], { surface: 'stone', tag: 'decimal-edge' });
  physics.addBox([-6.0, 0, -4.0], [-4.0, 0.34, -2.0], { surface: 'stone', tag: 'stair-step-1' });
  physics.addBox([-4.0, 0, -4.0], [-2.0, 0.68, -2.0], { surface: 'stone', tag: 'stair-step-2' });
  physics.addBox([-8.0, 2.05, 4.0], [-4.0, 2.6, 8.0], { surface: 'wood', tag: 'low-ceiling' });
  physics.addBox([-12.0, 0, -10.0], [-11.5, 6.0, 10.0], {
    surface: 'concrete',
    tag: 'air-wall-west',
    playerOnly: true,
  });
  physics.addBox([5.0, 1.2, -6.0], [5.6, 2.2, -5.2], {
    surface: 'metal',
    tag: 'bell-hitbox',
    bulletOnly: true,
  });
  physics.addBox([8.0, 0, 6.0], [10.0, 2.5, 6.4], {
    surface: 'wood',
    tag: 'glass-screen',
    noBullet: true,
  });

  // Populate remaining colliders up to 749 Hanamura-scale static architecture boxes
  while (physics.boxes.length < 749) {
    const cx = -36 + rng() * 68;
    const cz = -28 + rng() * 54;
    const w = 0.6 + rng() * 4.2;
    const d = 0.6 + rng() * 4.2;
    const y0 = rng() < 0.8 ? 0 : rng() * 3.5;
    const h = 0.35 + rng() * 4.5;
    const surface = surfaces[Math.floor(rng() * surfaces.length)];
    const roll = rng();
    physics.addBox([cx - w * 0.5, y0, cz - d * 0.5], [cx + w * 0.5, y0 + h, cz + d * 0.5], {
      surface,
      noNav: roll < 0.08,
      bulletOnly: roll >= 0.08 && roll < 0.12,
      playerOnly: roll >= 0.12 && roll < 0.15,
      noRay: roll >= 0.15 && roll < 0.18,
    });
  }

  physics.build();
}

test('engine.ts headless createPhysics delegates to SpatialArenaPhysics with SpatialHashGrid active', () => {
  const { createPhysics } = getHeadlessEnginePrimitives();
  const phys = createPhysics({}) as SpatialArenaPhysics;

  assert.ok(phys.telemetry, 'Expected SpatialArenaPhysics telemetry object');
  assert.equal(phys.telemetry.spatialAccelerated, true);

  const b = phys.addBox([-2, 0, -2], [2, 3, 2], { surface: 'stone' });
  phys.build();
  assert.equal(phys.telemetry.activeColliders, 1);
  assert.ok(phys.telemetry.gridNodes >= 1);

  const hit = phys.raycast(new THREE.Vector3(-6, 1.5, 0), new THREE.Vector3(1, 0, 0), 20);
  assert.ok(hit);
  assert.equal(hit.box, b);
  assert.equal(hit.surface, 'stone');
  assert.ok(Math.abs(hit.dist - 4) < 1e-4);
});

test('SpatialHashGrid mode and Legacy O(N) mode produce matching results across 749 Hanamura colliders', () => {
  const mockG = {
    level: {
      groundSurfaceAt(x: number, z: number) {
        return x > 10 && z > 0 ? 'metal' : 'concrete';
      },
    },
  };
  const phys = createSpatialArenaPhysics(mockG, HANAMURA_BOUNDS);
  populateHanamuraScaleColliders(phys, 4207);

  const rng = mulberry32(9001);

  // 1. Raycast parity (including analytical ground & sea planes, air-walls, bulletOnly)
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 0; i < 240; i++) {
    if (i === 0) {
      // Ray through air-wall-west: should ignore air-wall and hit behind or miss
      origin.set(-15, 1.5, 0);
      dir.set(1, 0, 0);
    } else if (i === 1) {
      // Ray downward onto sea beyond quayX (x > 30)
      origin.set(35, 4, 0);
      dir.set(0, -1, 0);
    } else if (i === 2) {
      // Ray downward onto metal ground plane
      origin.set(18, 12, 12);
      dir.set(0.1, -1, 0).normalize();
    } else if (i === 3) {
      // Ray hitting bulletOnly bell-hitbox
      origin.set(3.5, 1.7, -5.6);
      dir.set(1, 0, 0);
    } else {
      origin.set(-35 + rng() * 72, 0.4 + rng() * 9.0, -26 + rng() * 52);
      dir.set(rng() * 2 - 1, (rng() - 0.55) * 1.2, rng() * 2 - 1).normalize();
    }

    const maxDist = 60;
    phys.telemetry.setSpatialAccelerated(true);
    const sHit = phys.raycast(origin, dir, maxDist);
    const snapSpatial = sHit
      ? {
          dist: sHit.dist,
          px: sHit.point.x,
          py: sHit.point.y,
          pz: sHit.point.z,
          nx: sHit.normal.x,
          ny: sHit.normal.y,
          nz: sHit.normal.z,
          surface: sHit.surface,
          box: sHit.box,
        }
      : null;

    phys.telemetry.setSpatialAccelerated(false);
    const lHit = phys.raycast(origin, dir, maxDist);
    const snapLegacy = lHit
      ? {
          dist: lHit.dist,
          px: lHit.point.x,
          py: lHit.point.y,
          pz: lHit.point.z,
          nx: lHit.normal.x,
          ny: lHit.normal.y,
          nz: lHit.normal.z,
          surface: lHit.surface,
          box: lHit.box,
        }
      : null;

    assert.equal(Boolean(snapSpatial), Boolean(snapLegacy), `Ray #${i} hit mismatch`);
    if (snapSpatial && snapLegacy) {
      assert.ok(
        Math.abs(snapSpatial.dist - snapLegacy.dist) < 2e-4,
        `Ray #${i} dist mismatch: ${snapSpatial.dist} vs ${snapLegacy.dist}`,
      );
      assert.equal(snapSpatial.surface, snapLegacy.surface, `Ray #${i} surface mismatch`);
      assert.equal(snapSpatial.box, snapLegacy.box, `Ray #${i} box mismatch`);
      assert.ok(Math.abs(snapSpatial.nx - snapLegacy.nx) < 1e-4);
      assert.ok(Math.abs(snapSpatial.ny - snapLegacy.ny) < 1e-4);
      assert.ok(Math.abs(snapSpatial.nz - snapLegacy.nz) < 1e-4);
    }
  }

  // 2. lineOfSight parity
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  for (let i = 0; i < 160; i++) {
    pA.set(-32 + rng() * 64, 1.0 + rng() * 5.0, -24 + rng() * 48);
    pB.set(-32 + rng() * 64, 1.0 + rng() * 5.0, -24 + rng() * 48);
    phys.telemetry.setSpatialAccelerated(true);
    const losS = phys.lineOfSight(pA, pB);
    phys.telemetry.setSpatialAccelerated(false);
    const losL = phys.lineOfSight(pA, pB);
    assert.equal(losS, losL, `LOS #${i} mismatch`);
  }

  // 3. groundHeight parity (including exact float64 1.3 boundary & seaY)
  const testCoords: Array<[number, number, number]> = [
    [1.3, 1.6, 50],
    [1.0, 2.3, 50],
    [34.5, 4.0, 50],
    [5.3, -5.6, 50], // bulletOnly box must NOT raise groundHeight
  ];
  for (let i = 0; i < 220; i++) {
    testCoords.push([-36 + rng() * 74, -28 + rng() * 56, 4 + rng() * 40]);
  }
  for (let i = 0; i < testCoords.length; i++) {
    const [gx, gz, maxY] = testCoords[i];
    phys.telemetry.setSpatialAccelerated(true);
    const ghS = phys.groundHeight(gx, gz, maxY);
    phys.telemetry.setSpatialAccelerated(false);
    const ghL = phys.groundHeight(gx, gz, maxY);
    assert.equal(ghS, ghL, `groundHeight #${i} (${gx}, ${gz}) mismatch: ${ghS} vs ${ghL}`);
  }

  // 4. moveCapsule parity (wall slide, stair step-up, ceiling clamp, air-wall block)
  for (let i = 0; i < 120; i++) {
    const startX = i === 0 ? -11.3 : i === 1 ? -6.2 : i === 2 ? -6.0 : -30 + rng() * 58;
    const startY = i === 2 ? 0.22 : rng() < 0.7 ? 0 : 1.2 + rng() * 2.0;
    const startZ = i === 0 ? 0.0 : i === 1 ? -3.0 : i === 2 ? 6.0 : -24 + rng() * 48;
    const vx = i === 0 ? -5.0 : i === 1 ? 6.0 : (rng() * 2 - 1) * 8.0;
    const vy = i === 2 ? 4.5 : rng() < 0.7 ? -2.0 : 3.0;
    const vz = i === 0 ? 1.5 : i === 1 ? 0.0 : (rng() * 2 - 1) * 8.0;
    const grounded = startY === 0 || rng() < 0.6;

    const posS = new THREE.Vector3(startX, startY, startZ);
    const velS = new THREE.Vector3(vx, vy, vz);
    phys.telemetry.setSpatialAccelerated(true);
    const resS = { ...phys.moveCapsule(posS, velS, 1 / 60, 0.32, 1.8, grounded) };

    const posL = new THREE.Vector3(startX, startY, startZ);
    const velL = new THREE.Vector3(vx, vy, vz);
    phys.telemetry.setSpatialAccelerated(false);
    const resL = { ...phys.moveCapsule(posL, velL, 1 / 60, 0.32, 1.8, grounded) };

    assert.equal(resS.onGround, resL.onGround, `Capsule #${i} onGround mismatch`);
    assert.equal(resS.hitWall, resL.hitWall, `Capsule #${i} hitWall mismatch`);
    assert.equal(resS.hitCeil, resL.hitCeil, `Capsule #${i} hitCeil mismatch`);
    assert.equal(resS.surface, resL.surface, `Capsule #${i} surface mismatch`);
    assert.ok(posS.distanceTo(posL) < 1e-5, `Capsule #${i} pos mismatch`);
    assert.ok(velS.distanceTo(velL) < 1e-5, `Capsule #${i} vel mismatch`);
  }

  phys.telemetry.setSpatialAccelerated(true);
});

test('removeBox tombstones SpatialHashGrid slot in O(1) and grid compacts safely across restarts', () => {
  const phys = createSpatialArenaPhysics({}, HANAMURA_BOUNDS);
  const destructible = phys.addBox([4, 0, -2], [5, 3, 2], {
    surface: 'wood',
    tag: 'destructible-fusuma',
  });
  phys.build();

  const rayOrigin = new THREE.Vector3(0, 1.5, 0);
  const rayDir = new THREE.Vector3(1, 0, 0);
  assert.equal(phys.raycast(rayOrigin, rayDir, 10)?.box, destructible);
  assert.equal(phys.groundHeight(4.5, 0, 10), 3);
  assert.equal(phys.nav.isWalkable(4.5, 0), false);

  phys.removeBox(destructible);
  assert.equal(phys.telemetry.activeColliders, 0);
  assert.equal(phys.raycast(rayOrigin, rayDir, 10), null);
  assert.equal(phys.groundHeight(4.5, 0, 10), 0);
  assert.equal(phys.nav.isWalkable(4.5, 0), true);

  // Stress add/remove > 3800 times to verify automatic slot compaction without overflow
  for (let cycle = 0; cycle < 4100; cycle++) {
    const temp = phys.addBox([-1, 0, -1], [1, 2, 1], { surface: 'stone' });
    phys.removeBox(temp);
  }
  const survivor = phys.addBox([8, 0, -1], [9, 2.5, 1], { surface: 'metal' });
  assert.equal(phys.telemetry.activeColliders, 1);
  assert.equal(phys.raycast(rayOrigin, rayDir, 20)?.box, survivor);
});

test('SpatialHashGrid physics achieves >4x speedup over Legacy O(N) and records telemetry', () => {
  const phys = createSpatialArenaPhysics({}, HANAMURA_BOUNDS);
  populateHanamuraScaleColliders(phys, 4207);
  phys.telemetry.setTimingEnabled(true);

  const rng = mulberry32(1337);
  const rays: Array<{ o: THREE.Vector3; d: THREE.Vector3 }> = [];
  for (let i = 0; i < 100; i++) {
    rays.push({
      o: new THREE.Vector3(-30 + rng() * 60, 1.6, -22 + rng() * 44),
      d: new THREE.Vector3(rng() * 2 - 1, (rng() - 0.5) * 0.4, rng() * 2 - 1).normalize(),
    });
  }

  const runBatch = (accelerated: boolean, frames: number): number => {
    phys.telemetry.setSpatialAccelerated(accelerated);
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      phys.telemetry.resetFrameCounters();
      for (let r = 0; r < rays.length; r++) {
        phys.raycast(rays[r].o, rays[r].d, 55);
      }
      for (let g = 0; g < 120; g++) {
        phys.groundHeight(-30 + (g % 30) * 2, -20 + Math.floor(g / 30) * 10, 30);
      }
      for (let c = 0; c < 24; c++) {
        pos.set(-20 + c * 1.5, 0.2, -10 + (c % 5) * 4);
        vel.set(4.5, -1.0, 2.0);
        phys.moveCapsule(pos, vel, 1 / 60, 0.32, 1.8, true);
      }
    }
    return (performance.now() - t0) / frames;
  };

  // Warmup JIT
  runBatch(true, 8);
  runBatch(false, 8);

  const spatialMs = runBatch(true, 30);
  const legacyMs = runBatch(false, 30);
  const speedup = legacyMs / Math.max(0.001, spatialMs);

  assert.ok(
    speedup > 4.0,
    `Expected >4x spatial speedup, got ${speedup.toFixed(2)}x (spatial=${spatialMs.toFixed(3)}ms, legacy=${legacyMs.toFixed(3)}ms)`,
  );
  assert.equal(phys.telemetry.raycastCalls, 100);
  assert.equal(phys.telemetry.groundCalls, 120);
  assert.equal(phys.telemetry.capsuleCalls, 24);
  assert.ok(phys.telemetry.physicsMsAcc > 0);
});

test('createPerfHud schedules subsystems in exact engine order and supports F3/F4 hotkeys', () => {
  const phys = createSpatialArenaPhysics({}, HANAMURA_BOUNDS);
  phys.addBox([-2, 0, -2], [2, 2, 2], { surface: 'stone' });
  phys.build();

  const mockG = {
    physics: phys,
    quality: { name: 'high' },
    enemies: { aliveCount: () => 5 },
    render: { stats: () => ({ calls: 158, tris: 63292, scale: 1 }) },
  };

  const hud = createPerfHud(mockG);
  assert.equal(hud.expanded, true);
  assert.equal(phys.telemetry.timingEnabled, true);
  assert.ok(document.getElementById('perf-hud'), 'Expected #perf-hud mounted in #app');

  const callOrder: string[] = [];
  const phaseInput: PerfHudPhaseInput = {
    dt: 1 / 60,
    rawFrameSec: 1 / 60,
    runInput: () => callOrder.push('input'),
    runGameplayAndPlayer: () => callOrder.push('mobility_game'),
    runWeapon: () => callOrder.push('combat_weapon'),
    runEnemies: () => callOrder.push('ai_enemies'),
    runWorldAndAudioHud: () => callOrder.push('world_fx_hud'),
    runRender: () => callOrder.push('webgl_render'),
  };

  for (let i = 0; i < 15; i++) {
    callOrder.length = 0;
    phys.raycast(new THREE.Vector3(-5, 1, 0), new THREE.Vector3(1, 0, 0), 10);
    hud.stepFrame(phaseInput);
  }

  assert.deepEqual(callOrder, [
    'input',
    'mobility_game',
    'combat_weapon',
    'ai_enemies',
    'world_fx_hud',
    'webgl_render',
  ]);

  const hudEl = document.getElementById('perf-hud')!;
  assert.ok(hudEl.textContent.includes('FPS'), 'Expected FPS readout in HUD text');
  assert.ok(hudEl.textContent.includes('DC: 158'), 'Expected DrawCall stats in HUD text');

  const dispatchKey = (code: string): void => {
    window.dispatchEvent({ type: 'keydown', code, repeat: false } as unknown as KeyboardEvent);
  };

  // F3 collapses and expands HUD
  dispatchKey('F3');
  assert.equal(hud.expanded, false);
  dispatchKey('F3');
  assert.equal(hud.expanded, true);

  // F4 toggles SpatialHashGrid <-> Legacy O(N) live A/B comparison
  assert.equal(phys.telemetry.spatialAccelerated, true);
  dispatchKey('F4');
  assert.equal(phys.telemetry.spatialAccelerated, false);
  assert.ok(hudEl.textContent.includes('Legacy O(N)'));
  dispatchKey('F4');
  assert.equal(phys.telemetry.spatialAccelerated, true);

  hud.dispose();
  assert.equal(document.getElementById('perf-hud'), null);
});
