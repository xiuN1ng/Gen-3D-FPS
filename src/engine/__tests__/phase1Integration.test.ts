import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ENTITY_GEN_MASK,
  ENTITY_INDEX_MASK,
  NULL_ENTITY,
  SystemPipeline,
  World,
  defineComponent,
  defineEvent,
  defineTag,
  entityGeneration,
  entityIndex,
  packEntityId,
  type EntityId,
} from '../ecs/index';

import {
  ALL_SPATIAL_LAYERS,
  SpatialHashGrid,
  createCapsuleCollisionResult,
  createGroundSampleHit,
  createSpatialRayHit,
} from '../spatial/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LAYER_WORLD = 1 << 0;
const LAYER_DESTRUCTIBLE = 1 << 1;
const LAYER_ACTOR = 1 << 2;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

describe('Phase 1 Cross-Module Integration — Zero-GC ECS + SpatialHashGrid Combat Loop', () => {
  it('executes a full 120Hz mobility + broadphase + DDA hitscan/destructible + AoE + deferred-destroy loop with ABA safety', () => {
    const Transform = defineComponent('Transform', {
      x: 'f32',
      y: 'f32',
      z: 'f32',
    });
    const Velocity = defineComponent('Velocity', {
      vx: 'f32',
      vy: 'f32',
      vz: 'f32',
    });
    const CapsuleBody = defineComponent(
      'CapsuleBody',
      { radius: 'f32', height: 'f32', grounded: 'u8' },
      { radius: 0.35, height: 1.8, grounded: 0 },
    );
    const Health = defineComponent('Health', { hp: 'f32', maxHp: 'f32' }, { hp: 100, maxHp: 100 });
    const DestructibleTag = defineTag('DestructibleTag');
    const ActorTag = defineTag('ActorTag');

    const HitscanRequest = defineEvent(
      'HitscanRequest',
      {
        shooter: 'u32',
        ox: 'f32',
        oy: 'f32',
        oz: 'f32',
        dx: 'f32',
        dy: 'f32',
        dz: 'f32',
        damage: 'f32',
        splashRadius: 'f32',
      },
      { capacity: 64 },
    );

    const DamageEvent = defineEvent(
      'DamageEvent',
      {
        attacker: 'u32',
        victim: 'u32',
        amount: 'f32',
      },
      { capacity: 256 },
    );

    const world = new World({ maxEntities: 512 });
    const staticGrid = new SpatialHashGrid({ maxItems: 256, maxNodes: 4096 });
    const actorGrid = new SpatialHashGrid({ maxItems: 256, maxNodes: 2048 });

    const tf = world.getStore(Transform);
    const vel = world.getStore(Velocity);
    const body = world.getStore(CapsuleBody);
    const hp = world.getStore(Health);

    const hitscanBus = world.events(HitscanRequest);
    const damageBus = world.events(DamageEvent);
    const telemetryDamageCursor = damageBus.createCursor();

    // 1. Static arena floor + stair step (0.3m <= 0.35m stepHeight) + tall backstop wall
    staticGrid.insertAABB(900_001, -40, -1, -40, 40, 0, 40, LAYER_WORLD);
    staticGrid.insertAABB(900_002, 2.0, 0, -4, 6.0, 0.3, 4, LAYER_WORLD);
    staticGrid.insertAABB(900_003, 30.0, 0, -10, 32.0, 6.0, 10, LAYER_WORLD);

    // 2. Destructible wooden screen entity at x = [8, 8.5] registered in staticGrid with its EntityId
    const destructibleWall = world.createEntityStrict();
    world.addComponent(destructibleWall, Health, { hp: 40, maxHp: 40 });
    world.addComponent(destructibleWall, DestructibleTag);
    staticGrid.insertAABB(destructibleWall, 8.0, 0, -3.0, 8.5, 3.0, 3.0, LAYER_DESTRUCTIBLE);

    // 3. Player shooter at x = 0, aiming +X
    const player = world.createEntityStrict();
    world.addComponent(player, Transform, { x: 0, y: 0, z: 0 });
    world.addComponent(player, Velocity, { vx: 12, vy: 0, vz: 0 });
    world.addComponent(player, CapsuleBody, { radius: 0.35, height: 1.8 });
    world.addComponent(player, Health, { hp: 200, maxHp: 200 });
    world.addComponent(player, ActorTag);

    // 4. Two enemy actors behind the destructible wall at x = 14 (primary) and x = 15.2 (splash neighbor)
    const enemyPrimary = world.createEntityStrict();
    world.addComponent(enemyPrimary, Transform, { x: 14.0, y: 0, z: 0 });
    world.addComponent(enemyPrimary, Velocity, { vx: 0, vy: 0, vz: 0 });
    world.addComponent(enemyPrimary, CapsuleBody, { radius: 0.4, height: 1.8 });
    world.addComponent(enemyPrimary, Health, { hp: 80, maxHp: 80 });
    world.addComponent(enemyPrimary, ActorTag);

    const enemySplash = world.createEntityStrict();
    world.addComponent(enemySplash, Transform, { x: 15.2, y: 0, z: 0.4 });
    world.addComponent(enemySplash, Velocity, { vx: 0, vy: 0, vz: 0 });
    world.addComponent(enemySplash, CapsuleBody, { radius: 0.4, height: 1.8 });
    world.addComponent(enemySplash, Health, { hp: 50, maxHp: 50 });
    world.addComponent(enemySplash, ActorTag);

    const qMovers = world.query({ all: [Transform, Velocity, CapsuleBody] });
    const qActors = world.query({ all: [Transform, CapsuleBody, Health, ActorTag] });

    // Pre-allocated scratch structures for zero-GC system execution
    const capsuleRes = createCapsuleCollisionResult();
    const groundHit = createGroundSampleHit();
    const staticRayHit = createSpatialRayHit();
    const actorRayHit = createSpatialRayHit();
    const splashOutIds = new Uint32Array(32);

    let totalTelemetryDamageEvents = 0;

    const pipeline = new SystemPipeline(world);
    pipeline
      .addSystem({
        name: 'character_mobility',
        phase: 'mobility',
        execute(ctx) {
          const dt = ctx.dt;
          for (let i = 0, n = qMovers.count; i < n; i++) {
            const s = qMovers.dense[i];
            const nx = tf.x[s] + vel.vx[s] * dt;
            const ny = tf.y[s] + vel.vy[s] * dt;
            const nz = tf.z[s] + vel.vz[s] * dt;

            staticGrid.resolveCapsuleStatic(
              nx,
              ny,
              nz,
              body.radius[s],
              body.height[s],
              LAYER_WORLD | LAYER_DESTRUCTIBLE,
              capsuleRes,
            );

            tf.x[s] = capsuleRes.resolvedX;
            tf.y[s] = capsuleRes.resolvedBaseY;
            tf.z[s] = capsuleRes.resolvedZ;
            body.grounded[s] = capsuleRes.grounded ? 1 : 0;
          }
        },
      })
      .addSystem({
        name: 'actor_broadphase_rebuild',
        phase: 'broadphase',
        execute() {
          actorGrid.clear();
          for (let i = 0, n = qActors.count; i < n; i++) {
            const s = qActors.dense[i];
            const id = qActors.entities[i];
            actorGrid.insertCapsule(
              id,
              tf.x[s],
              tf.y[s],
              tf.z[s],
              body.radius[s],
              body.height[s],
              LAYER_ACTOR,
            );
          }
        },
      })
      .addSystem({
        name: 'hitscan_raycast',
        phase: 'collision',
        execute() {
          for (let i = 0, n = hitscanBus.length; i < n; i++) {
            const rSlot = hitscanBus.slotAt(i);
            const shooterId = hitscanBus.columns.shooter[rSlot];
            const ox = hitscanBus.columns.ox[rSlot];
            const oy = hitscanBus.columns.oy[rSlot];
            const oz = hitscanBus.columns.oz[rSlot];
            const dx = hitscanBus.columns.dx[rSlot];
            const dy = hitscanBus.columns.dy[rSlot];
            const dz = hitscanBus.columns.dz[rSlot];
            const dmg = hitscanBus.columns.damage[rSlot];
            const splashR = hitscanBus.columns.splashRadius[rSlot];

            const hitStatic = staticGrid.raycastAABB(
              ox,
              oy,
              oz,
              dx,
              dy,
              dz,
              100,
              LAYER_WORLD | LAYER_DESTRUCTIBLE,
              staticRayHit,
              { ignoreInsideOrigin: true, ignoreId: shooterId },
            );

            const maxActorDist = hitStatic ? staticRayHit.distance : 100;
            const hitActor = actorGrid.raycastAABB(
              ox,
              oy,
              oz,
              dx,
              dy,
              dz,
              maxActorDist,
              LAYER_ACTOR,
              actorRayHit,
              { ignoreInsideOrigin: false, ignoreId: shooterId },
            );

            if (hitActor) {
              damageBus.emit({ attacker: shooterId, victim: actorRayHit.id, amount: dmg });
              if (splashR > 0) {
                const count = actorGrid.querySphere(
                  actorRayHit.pointX,
                  actorRayHit.pointY,
                  actorRayHit.pointZ,
                  splashR,
                  LAYER_ACTOR,
                  splashOutIds,
                );
                for (let k = 0; k < count; k++) {
                  const splashVictim = splashOutIds[k];
                  if (splashVictim !== actorRayHit.id && splashVictim !== shooterId) {
                    damageBus.emit({
                      attacker: shooterId,
                      victim: splashVictim,
                      amount: dmg * 0.5,
                    });
                  }
                }
              }
            } else if (hitStatic && world.isAlive(staticRayHit.id)) {
              damageBus.emit({ attacker: shooterId, victim: staticRayHit.id, amount: dmg });
            }
          }
        },
      })
      .addSystem({
        name: 'combat_damage_apply',
        phase: 'combat',
        execute(ctx) {
          for (let i = 0, n = damageBus.length; i < n; i++) {
            const dSlot = damageBus.slotAt(i);
            const victimId = damageBus.columns.victim[dSlot];
            const vSlot = ctx.world.slotOf(victimId);
            if (vSlot === -1 || !ctx.world.hasComponent(victimId, Health)) continue;

            hp.hp[vSlot] -= damageBus.columns.amount[dSlot];
            if (hp.hp[vSlot] <= 0) {
              if (ctx.world.hasComponent(victimId, DestructibleTag)) {
                // O(1) mid-frame tombstone in staticGrid without rebuilding 750+ colliders
                staticGrid.disableById(victimId);
              }
              ctx.world.deferDestroy(victimId);
            }
          }
        },
      })
      .addSystem({
        name: 'telemetry_counter',
        phase: 'telemetry',
        execute() {
          totalTelemetryDamageEvents += damageBus.readCursor(telemetryDamageCursor, () => {});
        },
      });

    // Advance 25 ticks @ 120Hz (~0.208s): player moves from x=0 -> x=2.5 and climbs onto 0.3m stair!
    for (let t = 0; t < 25; t++) {
      pipeline.step(1 / 120);
    }

    const playerSlot = world.slotOf(player);
    assert.ok(tf.x[playerSlot] > 2.2, `expected player past stair edge x=2.0, got ${tf.x[playerSlot]}`);
    assert.ok(Math.abs(tf.y[playerSlot] - 0.3) <= 1e-4, `expected stair climb y=0.3, got ${tf.y[playerSlot]}`);
    assert.equal(body.grounded[playerSlot], 1);

    const sampled = staticGrid.sampleGroundHeight(tf.x[playerSlot], 0, 2.0, -10, LAYER_WORLD, groundHit);
    assert.equal(sampled.found, true);
    assert.ok(Math.abs(sampled.groundY - 0.3) <= 1e-5);

    // Tick 26: Player fires Shot #1 (50 dmg) -> hits destructibleWall (40 HP), destroying it & tombstoning staticGrid!
    vel.vx[playerSlot] = 0;
    hitscanBus.emit({
      shooter: player,
      ox: tf.x[playerSlot],
      oy: tf.y[playerSlot] + 1.2,
      oz: 0,
      dx: 1,
      dy: 0,
      dz: 0,
      damage: 50,
      splashRadius: 2.5,
    });
    pipeline.step(1 / 120);

    assert.equal(world.isAlive(destructibleWall), false, 'destructibleWall must be flushed after combat phase');
    assert.equal(world.isAlive(enemyPrimary), true, 'Shot #1 was absorbed by destructibleWall');

    // Queue a stale damage event against already-destroyed destructibleWall + fire Shot #2 (90 dmg + 2.5m splash)
    damageBus.emit({ attacker: player, victim: destructibleWall, amount: 999 });
    hitscanBus.emit({
      shooter: player,
      ox: tf.x[playerSlot],
      oy: tf.y[playerSlot] + 1.2,
      oz: 0,
      dx: 1,
      dy: 0,
      dz: 0,
      damage: 90,
      splashRadius: 2.5,
    });
    pipeline.step(1 / 120);

    // Shot #2 passed cleanly through tombstoned wall, killed enemyPrimary (80 - 90 <= 0), and splashed enemySplash (50 - 45 = 5 HP)!
    assert.equal(world.isAlive(enemyPrimary), false);
    assert.equal(world.isAlive(enemySplash), true);
    assert.ok(Math.abs(hp.hp[world.slotOf(enemySplash)] - 5) <= 1e-4);
    assert.equal(totalTelemetryDamageEvents, 4); // 1 wall hit + 1 stale event + 1 primary hit + 1 splash hit
  });

  it('preserves full 31-bit Smi EntityId fidelity (up to 0x7fffffff) across World and SpatialHashGrid typed buffers', () => {
    const maxId: EntityId = packEntityId(ENTITY_INDEX_MASK, ENTITY_GEN_MASK);
    assert.equal(maxId, 0x7fffffff);
    assert.equal(entityIndex(maxId), 4095);
    assert.equal(entityGeneration(maxId), 0x7ffff);

    const world = new World({ maxEntities: 4096 });
    const Tag = defineTag('MaxCapTag');
    const q = world.query({ all: [Tag] });
    let lastEntity = NULL_ENTITY;
    for (let i = 0; i < 4096; i++) {
      lastEntity = world.createEntityStrict();
      if (i === 4095) {
        world.addComponent(lastEntity, Tag);
      }
    }
    assert.equal(world.aliveCount, 4096);
    assert.equal(world.createEntity(), NULL_ENTITY);
    assert.equal(entityIndex(lastEntity), 4095);
    assert.equal(q.count, 1);
    assert.equal(q.entities[0], lastEntity);

    const grid = new SpatialHashGrid({ maxItems: 16, maxNodes: 64 });
    const slot = grid.insertAABB(maxId, -1, 0, -1, 1, 2, 1, ALL_SPATIAL_LAYERS);
    assert.equal(slot, 0);

    const outU32 = new Uint32Array(4);
    const outI32 = new Int32Array(4);
    assert.equal(grid.queryAABB(-2, -1, -2, 2, 3, 2, ALL_SPATIAL_LAYERS, outU32), 1);
    assert.equal(grid.querySphere(0, 1, 0, 2, ALL_SPATIAL_LAYERS, outI32), 1);
    assert.equal(outU32[0], maxId);
    assert.equal(outI32[0], maxId);

    const rayHit = createSpatialRayHit();
    assert.equal(grid.raycastAABB(-5, 1, 0, 1, 0, 0, 20, ALL_SPATIAL_LAYERS, rayHit), true);
    assert.equal(rayHit.id, maxId);

    const groundHit = grid.sampleGroundHeight(0, 0, 5, -1, ALL_SPATIAL_LAYERS);
    assert.equal(groundHit.found, true);
    assert.equal(groundHit.id, maxId);
    assert.equal(grid.disableById(maxId), 1);
    assert.equal(grid.activeCount, 0);
  });

  it('sustains combined ECS + SpatialHashGrid 120Hz simulation step well within frame budget', () => {
    const Pos = defineComponent('BenchPos', { x: 'f32', y: 'f32', z: 'f32' });
    const Vel = defineComponent('BenchVel', { vx: 'f32', vz: 'f32' });
    const world = new World({ maxEntities: 512 });
    const grid = new SpatialHashGrid({ maxItems: 512, maxNodes: 4096 });
    const pos = world.getStore(Pos);
    const vel = world.getStore(Vel);

    for (let i = 0; i < 300; i++) {
      const id = world.createEntityStrict();
      world.addComponent(id, Pos, {
        x: ((i % 25) - 12) * 3.2,
        y: 1.0,
        z: (Math.floor(i / 25) - 6) * 3.2,
      });
      world.addComponent(id, Vel, {
        vx: ((i * 5) % 9) - 4,
        vz: ((i * 11) % 7) - 3,
      });
    }

    const q = world.query({ all: [Pos, Vel] });
    const outIds = new Uint32Array(32);
    let neighborSum = 0;

    const pipeline = new SystemPipeline(world);
    pipeline
      .addSystem({
        name: 'move_and_index',
        phase: 'broadphase',
        execute(ctx) {
          grid.clear();
          const dt = ctx.dt;
          for (let i = 0, n = q.count; i < n; i++) {
            const s = q.dense[i];
            const id = q.entities[i];
            let nx = pos.x[s] + vel.vx[s] * dt;
            let nz = pos.z[s] + vel.vz[s] * dt;
            if (nx < -80 || nx > 80) {
              vel.vx[s] = -vel.vx[s];
              nx = pos.x[s];
            }
            if (nz < -80 || nz > 80) {
              vel.vz[s] = -vel.vz[s];
              nz = pos.z[s];
            }
            pos.x[s] = nx;
            pos.z[s] = nz;
            grid.insertSphere(id, nx, pos.y[s], nz, 0.45, 1);
          }
        },
      })
      .addSystem({
        name: 'proximity_queries',
        phase: 'collision',
        execute() {
          for (let i = 0, n = q.count; i < n; i++) {
            const s = q.dense[i];
            neighborSum += grid.querySphere(pos.x[s], pos.y[s], pos.z[s], 2.5, 1, outIds);
          }
        },
      });

    for (let w = 0; w < 40; w++) {
      pipeline.step(1 / 120);
    }
    pipeline.resetTimings();

    const t0 = performance.now();
    const TICKS = 240;
    for (let t = 0; t < TICKS; t++) {
      pipeline.step(1 / 120);
    }
    const avgMs = (performance.now() - t0) / TICKS;

    assert.ok(neighborSum > 0);
    assert.ok(avgMs < 2.0, `Expected combined ECS+Spatial 120Hz tick < 2.0ms, got ${avgMs.toFixed(4)}ms`);
  });

  it('enforces repository-wide Phase 1 strict TypeScript & architectural boundary invariants across src/', () => {
    const srcRoot = path.resolve(__dirname, '../..');
    const engineRoot = path.resolve(__dirname, '..');

    const allSrcFiles = collectFiles(srcRoot);
    const jsBypassFiles = allSrcFiles.filter((f) => /\.(c|m)?jsx?$/i.test(f));
    assert.deepEqual(jsBypassFiles, [], 'src/ must not contain unchecked .js/.jsx bypass files');

    const tsFiles = allSrcFiles.filter((f) => /\.tsx?$/i.test(f));
    assert.ok(tsFiles.length >= 15);

    for (const file of tsFiles) {
      const rel = path.relative(srcRoot, file);
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(
        /@ts-(nocheck|ignore|expect-error)/.test(content),
        false,
        `Forbidden TypeScript suppression directive found in src/${rel}`,
      );
    }

    const engineProdFiles = collectFiles(engineRoot).filter(
      (f) => f.endsWith('.ts') && !f.includes(`${path.sep}__tests__${path.sep}`),
    );
    assert.ok(engineProdFiles.length >= 10);

    for (const file of engineProdFiles) {
      const rel = path.relative(engineRoot, file);
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(/from\s+['"](three|react|react-dom)/.test(content), false, `Forbidden import in engine/${rel}`);
      assert.equal(/src\/game|\.\.\/game|\.\.\/\.\.\/game/.test(content), false, `Forbidden game coupling in engine/${rel}`);
      assert.equal(
        /\b(window|document|navigator|HTMLElement|HTMLCanvasElement|WebGLRenderingContext|WebGL2RenderingContext)\b/.test(
          content,
        ),
        false,
        `Forbidden DOM/WebGL global in engine/${rel}`,
      );
    }
  });
});
