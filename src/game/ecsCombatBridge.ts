import * as THREE from 'three';
import {
  ENTITY_INDEX_MASK,
  NULL_ENTITY,
  World,
  defineComponent,
  defineEvent,
  defineTag,
  type EntityId,
  type EventRingBuffer,
  type Query,
} from '../engine/ecs/index.ts';
import { SpatialHashGrid } from '../engine/spatial/index.ts';

export const LAYER_DYNAMIC_ENEMY = 1 << 0;

export const PROJECTILE_KIND = {
  ENEMY_BOLT: 1,
  GENJI_SHURIKEN: 2,
  GENJI_SWORD_WAVE: 3,
  HANZO_ARROW: 4,
  GUNNER_PULSE: 5,
  GUNNER_HELIX: 6,
  DEFLECT_SPEAR: 7,
} as const;

export const CombatTransform = defineComponent('CombatTransform', {
  x: 'f32',
  y: 'f32',
  z: 'f32',
  prevX: 'f32',
  prevY: 'f32',
  prevZ: 'f32',
});

export const CombatVelocity = defineComponent('CombatVelocity', {
  vx: 'f32',
  vy: 'f32',
  vz: 'f32',
  speed: 'f32',
});

export const CombatHealth = defineComponent('CombatHealth', {
  hp: 'f32',
  maxHp: 'f32',
  alive: 'u8',
  typeCode: 'u8',
});

export const EnemyHitbox = defineComponent(
  'EnemyHitbox',
  {
    enemyId: 'i32',
    centerYOffset: 'f32',
    hitR2: 'f32',
    spatialSlot: 'i32',
  },
  {
    spatialSlot: -1,
    hitR2: 2.6,
  },
);

export const ProjectileFlight = defineComponent('ProjectileFlight', {
  kind: 'u8',
  poolIndex: 'u16',
  damage: 'f32',
  life: 'f32',
  faction: 'u8',
});

export const EnemyActorTag = defineTag('EnemyActor');
export const ProjectileActorTag = defineTag('ProjectileActor');

export const CombatDamageEvent = defineEvent(
  'CombatDamageEvent',
  {
    entityId: 'u32',
    enemyId: 'i32',
    amount: 'f32',
    partCode: 'u8',
    killed: 'u8',
  },
  { capacity: 256 },
);

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface EnemyRaycastHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  enemy: any;
  part: string;
}

export interface EnemyActorLike {
  id: number;
  type: string;
  pos: Vec3Like;
  vel?: Vec3Like;
  speed?: number;
  yaw?: number;
  hp: number;
  maxHp?: number;
  alive: boolean;
  active?: boolean;
  __hitR2?: number;
  _raycast: (
    origin: Vec3Like,
    dir: Vec3Like,
    maxDist: number,
    hit: EnemyRaycastHit,
  ) => boolean;
}

export interface RegisteredProjectilePool<T = any> {
  readonly name: string;
  readonly kind: number;
  readonly faction: 0 | 1; // 0 = player, 1 = enemy
  readonly items: readonly T[];
  isActive: (item: T) => boolean;
  getPos?: (item: T) => Vec3Like;
  getVel?: (item: T) => Vec3Like | null;
  getDir?: (item: T) => Vec3Like | null;
  getSpeed?: (item: T) => number;
  getDamage?: (item: T) => number;
  getLife?: (item: T) => number;
}

export interface SphereQueryOptions {
  ignoreY?: boolean;
  skipAutoSync?: boolean;
}

export interface EcsCombatTelemetry {
  spatialAccelerated: boolean;
  timingEnabled: boolean;
  activeEntities: number;
  enemyEntities: number;
  projectileEntities: number;
  dynamicGridActive: number;
  dynamicGridNodes: number;
  enemyRaycastCalls: number;
  aoeQueryCalls: number;
  damageEventsTotal: number;
  damageEventsPerSec: number;
  combatMsAcc: number;
  lastCombatMs: number;
  emaCombatMs: number;
  resetFrameCounters: () => void;
  setSpatialAccelerated: (enabled: boolean) => void;
  setTimingEnabled: (enabled: boolean) => void;
}

export interface EcsCombatBridge {
  readonly world: World;
  readonly dynamicGrid: SpatialHashGrid;
  readonly enemyQuery: Query;
  readonly projectileQuery: Query;
  readonly damageEvents: EventRingBuffer<typeof CombatDamageEvent.schema>;
  readonly telemetry: EcsCombatTelemetry;
  bindEnemyList: (list: EnemyActorLike[]) => void;
  registerProjectilePool: <T = any>(pool: RegisteredProjectilePool<T>) => void;
  markEnemiesDirty: () => void;
  onEnemySpawn: (enemy: EnemyActorLike) => EntityId;
  onEnemyRetire: (enemy: EnemyActorLike) => void;
  onClear: () => void;
  syncEnemies: () => void;
  syncProjectiles: () => void;
  syncAll: () => void;
  entityOfEnemy: (enemy: EnemyActorLike) => EntityId;
  raycastEnemies: (
    origin: Vec3Like,
    dir: Vec3Like,
    maxDist?: number,
  ) => EnemyRaycastHit | null;
  queryEnemiesInSphere: <T extends EnemyActorLike = EnemyActorLike>(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    outActors: T[],
    options?: SphereQueryOptions,
  ) => number;
  recordDamageEvent: (
    enemy: EnemyActorLike | null,
    amount: number,
    part?: string,
    killed?: boolean,
  ) => void;
  tickTelemetryWindow: (dt: number) => void;
}

const DYNAMIC_GRID_MAX_ITEMS = 1024;
const DYNAMIC_GRID_MAX_NODES = 16384;
const DYNAMIC_GRID_COMPACT_THRESHOLD = 928;
const PARKED_MIN_X = -95.95;
const PARKED_MAX_X = -95.9;
const PARKED_MIN_Y = -9999.0;
const PARKED_MAX_Y = -9998.95;
const PARKED_MIN_Z = -95.95;
const PARKED_MAX_Z = -95.9;
const RAY_CHUNK_LEN = 16.0;

interface EnemyTrackRecord {
  actor: EnemyActorLike;
  entityId: EntityId;
  spatialSlot: number;
  listIndex: number;
  halfExtent: number;
}

interface InternalProjectilePoolEntry {
  readonly spec: RegisteredProjectilePool<any>;
  readonly entityIds: Uint32Array;
}

function encodeEnemyType(type: string): number {
  if (type === 'trooper') return 1;
  if (type === 'hound') return 2;
  if (type === 'gull') return 3;
  return 0;
}

function encodeHitPart(part: string | undefined): number {
  if (part === 'weak') return 1;
  if (part === 'splash') return 2;
  return 0;
}

function enemyCenterYOffset(type: string): number {
  if (type === 'trooper') return 0.95;
  if (type === 'hound') return 0.6;
  return 0;
}

export function createEcsCombatBridge(
  rawG?: unknown,
  existingWorld?: World,
): EcsCombatBridge {
  const G: Record<string, any> =
    rawG && typeof rawG === 'object' ? (rawG as Record<string, any>) : {};

  const world: World =
    existingWorld ??
    (G.ecsWorld instanceof World ? G.ecsWorld : new World({ maxEntities: 2048 }));
  G.ecsWorld = world;

  // Pre-register all SoA combat stores & queries up front
  const transformCols = world.getStore(CombatTransform);
  const velocityCols = world.getStore(CombatVelocity);
  const healthCols = world.getStore(CombatHealth);
  const hitboxCols = world.getStore(EnemyHitbox);
  const projectileCols = world.getStore(ProjectileFlight);

  const enemyQuery = world.query({
    all: [EnemyActorTag, CombatTransform, CombatHealth, EnemyHitbox],
  });
  const projectileQuery = world.query({
    all: [ProjectileActorTag, CombatTransform, CombatVelocity, ProjectileFlight],
  });
  const damageEvents = world.events(CombatDamageEvent);

  const dynamicGrid = new SpatialHashGrid({
    minX: -96,
    maxX: 96,
    minZ: -96,
    maxZ: 96,
    cellSize: 4.0,
    maxItems: DYNAMIC_GRID_MAX_ITEMS,
    maxNodes: DYNAMIC_GRID_MAX_NODES,
  });

  let enemyList: EnemyActorLike[] =
    G.enemies && Array.isArray(G.enemies.list) ? G.enemies.list : [];

  let persistentSlotByActor = new WeakMap<EnemyActorLike, number>();
  const activeRecordByActor = new WeakMap<EnemyActorLike, EnemyTrackRecord>();
  const trackedEnemies: EnemyTrackRecord[] = [];

  const slotToRecord: (EnemyTrackRecord | null)[] = new Array(
    DYNAMIC_GRID_MAX_ITEMS,
  ).fill(null);

  const projectilePools: InternalProjectilePoolEntry[] = [];
  const registeredPoolNames = new Set<string>();

  // Pre-allocated zero-GC scratch arrays for queries & candidate sorting
  const queryIds = new Uint32Array(DYNAMIC_GRID_MAX_ITEMS);
  const querySlots = new Int32Array(DYNAMIC_GRID_MAX_ITEMS);
  const chunkMergedSlots = new Int32Array(DYNAMIC_GRID_MAX_ITEMS);
  const rayVisitStamp = new Uint32Array(DYNAMIC_GRID_MAX_ITEMS);
  let currentRayStamp = 0;

  let hitRingIdx = 0;
  const hitRing: EnemyRaycastHit[] = [];
  for (let i = 0; i < 8; i++) {
    hitRing.push({
      dist: Infinity,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      enemy: null,
      part: 'body',
    });
  }

  let enemiesDirty = true;
  let syncedFrame = -1;
  let syncedAliveCount = -1;
  let maxActiveHalfExtent = 2.4;

  // Damage rate rolling 1s window
  let dmgSecAcc = 0;
  let dmgCountInWindow = 0;

  const telemetry: EcsCombatTelemetry = {
    spatialAccelerated: true,
    timingEnabled: false,
    activeEntities: 0,
    enemyEntities: 0,
    projectileEntities: 0,
    dynamicGridActive: 0,
    dynamicGridNodes: 0,
    enemyRaycastCalls: 0,
    aoeQueryCalls: 0,
    damageEventsTotal: 0,
    damageEventsPerSec: 0,
    combatMsAcc: 0,
    lastCombatMs: 0,
    emaCombatMs: 0,
    resetFrameCounters() {
      telemetry.enemyRaycastCalls = 0;
      telemetry.aoeQueryCalls = 0;
      telemetry.combatMsAcc = 0;
    },
    setSpatialAccelerated(enabled: boolean) {
      telemetry.spatialAccelerated = enabled;
      if (enabled) {
        enemiesDirty = true;
      }
    },
    setTimingEnabled(enabled: boolean) {
      telemetry.timingEnabled = enabled;
      if (!enabled) {
        telemetry.combatMsAcc = 0;
        telemetry.lastCombatMs = 0;
        telemetry.emaCombatMs = 0;
      }
    },
  };

  function refreshEntityCounts(): void {
    telemetry.activeEntities = world.aliveCount;
    telemetry.enemyEntities = enemyQuery.count;
    telemetry.projectileEntities = projectileQuery.count;
    telemetry.dynamicGridActive = trackedEnemies.length;
    telemetry.dynamicGridNodes = dynamicGrid.nodeCount;
  }

  function allocateOrReuseSpatialSlot(actor: EnemyActorLike): number {
    const existing = persistentSlotByActor.get(actor);
    if (existing !== undefined && existing >= 0 && existing < dynamicGrid.itemCount) {
      return existing;
    }

    if (dynamicGrid.itemCount >= DYNAMIC_GRID_COMPACT_THRESHOLD) {
      compactDynamicGrid();
    }

    const slot = dynamicGrid.insertAABB(
      actor.id | 0,
      PARKED_MIN_X,
      PARKED_MIN_Y,
      PARKED_MIN_Z,
      PARKED_MAX_X,
      PARKED_MAX_Y,
      PARKED_MAX_Z,
      LAYER_DYNAMIC_ENEMY,
    );
    if (slot >= 0) {
      persistentSlotByActor.set(actor, slot);
    }
    return slot;
  }

  function parkSpatialSlot(slot: number): void {
    if (slot < 0 || slot >= dynamicGrid.itemCount) return;
    slotToRecord[slot] = null;
    dynamicGrid.updateAABB(
      slot,
      PARKED_MIN_X,
      PARKED_MIN_Y,
      PARKED_MIN_Z,
      PARKED_MAX_X,
      PARKED_MAX_Y,
      PARKED_MAX_Z,
    );
  }

  function compactDynamicGrid(): void {
    dynamicGrid.clear();
    persistentSlotByActor = new WeakMap<EnemyActorLike, number>();
    slotToRecord.fill(null);

    for (let i = 0; i < trackedEnemies.length; i++) {
      const rec = trackedEnemies[i];
      const en = rec.actor;
      const cy = en.pos.y + enemyCenterYOffset(en.type);
      const r = rec.halfExtent;
      const slot = dynamicGrid.insertAABB(
        en.id | 0,
        en.pos.x - r,
        cy - r,
        en.pos.z - r,
        en.pos.x + r,
        cy + r,
        en.pos.z + r,
        LAYER_DYNAMIC_ENEMY,
      );
      rec.spatialSlot = slot;
      if (slot >= 0) {
        persistentSlotByActor.set(en, slot);
        slotToRecord[slot] = rec;
      }
      const ecsSlot = world.slotOf(rec.entityId);
      if (ecsSlot >= 0) {
        hitboxCols.spatialSlot[ecsSlot] = slot;
      }
    }
  }

  function destroyEnemyRecordAt(idx: number): void {
    const rec = trackedEnemies[idx];
    parkSpatialSlot(rec.spatialSlot);
    activeRecordByActor.delete(rec.actor);
    if (rec.entityId !== NULL_ENTITY && world.isAlive(rec.entityId)) {
      world.destroyEntity(rec.entityId);
    }
    rec.entityId = NULL_ENTITY;

    const lastIdx = trackedEnemies.length - 1;
    if (idx !== lastIdx) {
      trackedEnemies[idx] = trackedEnemies[lastIdx];
    }
    trackedEnemies.pop();
  }

  function upsertAliveEnemy(en: EnemyActorLike, listIdx: number): void {
    const yOff = enemyCenterYOffset(en.type);
    const hitR2 = en.__hitR2 && en.__hitR2 > 0 ? en.__hitR2 : 2.6;
    const halfExt = Math.max(2.25, Math.sqrt(hitR2) + 0.2);
    if (halfExt > maxActiveHalfExtent) {
      maxActiveHalfExtent = halfExt;
    }

    let rec = activeRecordByActor.get(en);
    if (!rec || !world.isAlive(rec.entityId)) {
      const eid = world.createEntity();
      if (eid === NULL_ENTITY) return;

      const sSlot = allocateOrReuseSpatialSlot(en);
      rec = {
        actor: en,
        entityId: eid,
        spatialSlot: sSlot,
        listIndex: listIdx,
        halfExtent: halfExt,
      };
      activeRecordByActor.set(en, rec);
      trackedEnemies.push(rec);

      world.addComponent(eid, EnemyActorTag);
      world.addComponent(eid, CombatTransform, {
        x: en.pos.x,
        y: en.pos.y,
        z: en.pos.z,
        prevX: en.pos.x,
        prevY: en.pos.y,
        prevZ: en.pos.z,
      });
      world.addComponent(eid, CombatVelocity);
      world.addComponent(eid, CombatHealth, {
        hp: en.hp,
        maxHp: en.maxHp ?? en.hp,
        alive: 1,
        typeCode: encodeEnemyType(en.type),
      });
      world.addComponent(eid, EnemyHitbox, {
        enemyId: en.id | 0,
        centerYOffset: yOff,
        hitR2,
        spatialSlot: sSlot,
      });
    } else {
      rec.listIndex = listIdx;
      rec.halfExtent = halfExt;
    }

    const ecsSlot = rec.entityId & ENTITY_INDEX_MASK;
    transformCols.prevX[ecsSlot] = transformCols.x[ecsSlot];
    transformCols.prevY[ecsSlot] = transformCols.y[ecsSlot];
    transformCols.prevZ[ecsSlot] = transformCols.z[ecsSlot];
    transformCols.x[ecsSlot] = en.pos.x;
    transformCols.y[ecsSlot] = en.pos.y;
    transformCols.z[ecsSlot] = en.pos.z;

    if (en.vel) {
      velocityCols.vx[ecsSlot] = en.vel.x;
      velocityCols.vy[ecsSlot] = en.vel.y;
      velocityCols.vz[ecsSlot] = en.vel.z;
      velocityCols.speed[ecsSlot] = Math.hypot(en.vel.x, en.vel.y, en.vel.z);
    } else {
      const spd = en.speed ?? 0;
      const yaw = en.yaw ?? 0;
      velocityCols.vx[ecsSlot] = Math.sin(yaw) * spd;
      velocityCols.vy[ecsSlot] = 0;
      velocityCols.vz[ecsSlot] = Math.cos(yaw) * spd;
      velocityCols.speed[ecsSlot] = spd;
    }

    healthCols.hp[ecsSlot] = en.hp;
    if ((en.maxHp ?? 0) > healthCols.maxHp[ecsSlot]) {
      healthCols.maxHp[ecsSlot] = en.maxHp ?? en.hp;
    }
    healthCols.alive[ecsSlot] = 1;
    hitboxCols.enemyId[ecsSlot] = en.id | 0;
    hitboxCols.centerYOffset[ecsSlot] = yOff;
    hitboxCols.hitR2[ecsSlot] = hitR2;

    const sSlot = rec.spatialSlot;
    if (sSlot >= 0) {
      slotToRecord[sSlot] = rec;
      const cy = en.pos.y + yOff;
      dynamicGrid.updateAABB(
        sSlot,
        en.pos.x - halfExt,
        cy - halfExt,
        en.pos.z - halfExt,
        en.pos.x + halfExt,
        cy + halfExt,
        en.pos.z + halfExt,
      );
    }
  }

  function syncEnemies(): void {
    const t0 = telemetry.timingEnabled ? performance.now() : 0;

    if (G.enemies && Array.isArray(G.enemies.list) && G.enemies.list !== enemyList) {
      enemyList = G.enemies.list;
    }

    // 1. Prune records whose actors died or left the active list
    for (let i = trackedEnemies.length - 1; i >= 0; i--) {
      const en = trackedEnemies[i].actor;
      if (!en.alive || en.active === false) {
        destroyEnemyRecordAt(i);
      }
    }

    // 2. Upsert all currently alive enemies into World SoA + dynamic SpatialHashGrid
    maxActiveHalfExtent = 2.4;
    let aliveCount = 0;
    for (let i = 0; i < enemyList.length; i++) {
      const en = enemyList[i];
      if (!en || !en.alive) continue;
      aliveCount++;
      upsertAliveEnemy(en, i);
    }

    // Catch any tracked record that remained `.alive` on a detached mock object removed from `enemyList`
    if (trackedEnemies.length > aliveCount) {
      for (let i = trackedEnemies.length - 1; i >= 0; i--) {
        if (enemyList.indexOf(trackedEnemies[i].actor) === -1) {
          destroyEnemyRecordAt(i);
        }
      }
    }

    enemiesDirty = false;
    syncedFrame = G.time && typeof G.time.frame === 'number' ? G.time.frame : 0;
    syncedAliveCount = aliveCount;
    refreshEntityCounts();

    if (telemetry.timingEnabled) {
      telemetry.combatMsAcc += performance.now() - t0;
    }
  }

  function ensureEnemiesSynced(): void {
    const curFrame = G.time ? (G.time.frame | 0) : 0;
    if (
      !enemiesDirty &&
      curFrame > 0 &&
      curFrame === syncedFrame &&
      trackedEnemies.length === syncedAliveCount
    ) {
      return;
    }
    syncEnemies();
  }

  function syncProjectiles(): void {
    const t0 = telemetry.timingEnabled ? performance.now() : 0;

    for (let p = 0; p < projectilePools.length; p++) {
      const entry = projectilePools[p];
      const spec = entry.spec;
      const items = spec.items;
      const eids = entry.entityIds;
      const len = Math.min(items.length, eids.length);

      for (let i = 0; i < len; i++) {
        const item = items[i];
        const active = Boolean(item && spec.isActive(item));
        let eid = eids[i];

        if (!active) {
          if (eid !== NULL_ENTITY) {
            if (world.isAlive(eid)) {
              world.destroyEntity(eid);
            }
            eids[i] = NULL_ENTITY;
          }
          continue;
        }

        const pos: Vec3Like = spec.getPos ? spec.getPos(item) : item.pos;
        if (!pos) continue;

        if (eid === NULL_ENTITY || !world.isAlive(eid)) {
          eid = world.createEntity();
          if (eid === NULL_ENTITY) continue;
          eids[i] = eid;

          world.addComponent(eid, ProjectileActorTag);
          world.addComponent(eid, CombatTransform, {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            prevX: pos.x,
            prevY: pos.y,
            prevZ: pos.z,
          });
          world.addComponent(eid, CombatVelocity);
          world.addComponent(eid, ProjectileFlight, {
            kind: spec.kind,
            poolIndex: i,
            faction: spec.faction,
          });
        }

        const slot = eid & ENTITY_INDEX_MASK;
        transformCols.prevX[slot] = transformCols.x[slot];
        transformCols.prevY[slot] = transformCols.y[slot];
        transformCols.prevZ[slot] = transformCols.z[slot];
        transformCols.x[slot] = pos.x;
        transformCols.y[slot] = pos.y;
        transformCols.z[slot] = pos.z;

        const vel = spec.getVel ? spec.getVel(item) : item.vel;
        if (vel && typeof vel.x === 'number') {
          velocityCols.vx[slot] = vel.x;
          velocityCols.vy[slot] = vel.y;
          velocityCols.vz[slot] = vel.z;
          velocityCols.speed[slot] = Math.hypot(vel.x, vel.y, vel.z);
        } else {
          const dir = spec.getDir ? spec.getDir(item) : item.dir;
          const spd = spec.getSpeed ? spec.getSpeed(item) : Number(item.speed || 0);
          if (dir && typeof dir.x === 'number') {
            velocityCols.vx[slot] = dir.x * spd;
            velocityCols.vy[slot] = dir.y * spd;
            velocityCols.vz[slot] = dir.z * spd;
          }
          velocityCols.speed[slot] = spd;
        }

        projectileCols.damage[slot] = spec.getDamage
          ? spec.getDamage(item)
          : Number(item.damage || 0);
        projectileCols.life[slot] = spec.getLife
          ? spec.getLife(item)
          : Number(item.life || 0);
      }
    }

    refreshEntityCounts();
    if (telemetry.timingEnabled) {
      telemetry.combatMsAcc += performance.now() - t0;
    }
  }

  function sortCandidateSlotsByListIndex(buf: Int32Array, count: number): void {
    for (let i = 1; i < count; i++) {
      const slot = buf[i];
      const key = slotToRecord[slot]?.listIndex ?? 0x7fffffff;
      let j = i - 1;
      while (j >= 0 && (slotToRecord[buf[j]]?.listIndex ?? 0x7fffffff) > key) {
        buf[j + 1] = buf[j];
        j--;
      }
      buf[j + 1] = slot;
    }
  }

  function testEnemyRayNarrowphase(
    en: EnemyActorLike,
    origin: Vec3Like,
    dir: Vec3Like,
    maxDist: number,
    currentHit: EnemyRaycastHit | null,
  ): EnemyRaycastHit | null {
    if (!en.alive) return currentHit;
    const qx = en.pos.x - origin.x;
    const qy = en.pos.y + enemyCenterYOffset(en.type) - origin.y;
    const qz = en.pos.z - origin.z;
    const proj = qx * dir.x + qy * dir.y + qz * dir.z;
    if (proj < -2.2 || proj > maxDist + 2.2) return currentHit;
    const perpSq = qx * qx + qy * qy + qz * qz - proj * proj;
    if (perpSq > (en.__hitR2 || 2.6)) return currentHit;

    let hit = currentHit;
    if (!hit) {
      hitRingIdx = (hitRingIdx + 1) & 7;
      hit = hitRing[hitRingIdx];
      hit.dist = Infinity;
      hit.enemy = null;
      hit.part = 'body';
    }
    en._raycast(origin, dir, maxDist, hit);
    return hit;
  }

  function raycastEnemiesLegacy(
    origin: Vec3Like,
    dir: Vec3Like,
    maxDist: number,
  ): EnemyRaycastHit | null {
    const list =
      G.enemies && Array.isArray(G.enemies.list) ? G.enemies.list : enemyList;
    let hit: EnemyRaycastHit | null = null;
    for (let j = 0; j < list.length; j++) {
      const en = list[j];
      if (!en || !en.alive) continue;
      hit = testEnemyRayNarrowphase(en, origin, dir, maxDist, hit);
    }
    return hit && hit.enemy ? hit : null;
  }

  function raycastEnemies(
    origin: Vec3Like,
    dir: Vec3Like,
    maxDist = 300,
  ): EnemyRaycastHit | null {
    telemetry.enemyRaycastCalls++;
    const t0 = telemetry.timingEnabled ? performance.now() : 0;

    if (!telemetry.spatialAccelerated) {
      const legacyRes = raycastEnemiesLegacy(origin, dir, maxDist);
      if (telemetry.timingEnabled) {
        telemetry.combatMsAcc += performance.now() - t0;
      }
      return legacyRes;
    }

    ensureEnemiesSynced();
    if (trackedEnemies.length === 0) {
      if (telemetry.timingEnabled) {
        telemetry.combatMsAcc += performance.now() - t0;
      }
      return null;
    }

    const lenSq = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
    if (lenSq < 1e-18 || !(maxDist >= 0)) {
      if (telemetry.timingEnabled) {
        telemetry.combatMsAcc += performance.now() - t0;
      }
      return null;
    }
    let dirLen = 1;
    let ux = dir.x;
    let uy = dir.y;
    let uz = dir.z;
    if (Math.abs(lenSq - 1) > 1e-4) {
      dirLen = Math.sqrt(lenSq);
      const invLen = 1 / dirLen;
      ux = dir.x * invLen;
      uy = dir.y * invLen;
      uz = dir.z * invLen;
    }

    const endT = maxDist * dirLen;
    let hit: EnemyRaycastHit | null = null;

    if (endT <= RAY_CHUNK_LEN) {
      const ax = origin.x;
      const ay = origin.y;
      const az = origin.z;
      const bx = ax + ux * endT;
      const by = ay + uy * endT;
      const bz = az + uz * endT;

      const count = dynamicGrid.queryAABB(
        ax <= bx ? ax : bx,
        ay <= by ? ay : by,
        az <= bz ? az : bz,
        ax <= bx ? bx : ax,
        ay <= by ? by : ay,
        az <= bz ? bz : az,
        LAYER_DYNAMIC_ENEMY,
        queryIds,
        querySlots,
      );

      if (count > 1) {
        sortCandidateSlotsByListIndex(querySlots, count);
      }

      for (let k = 0; k < count; k++) {
        const rec = slotToRecord[querySlots[k]];
        if (!rec) continue;
        hit = testEnemyRayNarrowphase(rec.actor, origin, dir, maxDist, hit);
      }
    } else {
      currentRayStamp = (currentRayStamp + 1) >>> 0;
      if (currentRayStamp === 0) {
        rayVisitStamp.fill(0);
        currentRayStamp = 1;
      }
      const stamp = currentRayStamp;

      for (let segStart = 0; segStart < endT; segStart += RAY_CHUNK_LEN) {
        const segEnd = Math.min(endT, segStart + RAY_CHUNK_LEN);
        const ax = origin.x + ux * segStart;
        const ay = origin.y + uy * segStart;
        const az = origin.z + uz * segStart;
        const bx = origin.x + ux * segEnd;
        const by = origin.y + uy * segEnd;
        const bz = origin.z + uz * segEnd;

        const rawCount = dynamicGrid.queryAABB(
          ax <= bx ? ax : bx,
          ay <= by ? ay : by,
          az <= bz ? az : bz,
          ax <= bx ? bx : ax,
          ay <= by ? by : ay,
          az <= bz ? bz : az,
          LAYER_DYNAMIC_ENEMY,
          queryIds,
          querySlots,
        );

        let uniqueCount = 0;
        for (let k = 0; k < rawCount; k++) {
          const s = querySlots[k];
          if (rayVisitStamp[s] === stamp) continue;
          rayVisitStamp[s] = stamp;
          chunkMergedSlots[uniqueCount++] = s;
        }

        if (uniqueCount > 1) {
          sortCandidateSlotsByListIndex(chunkMergedSlots, uniqueCount);
        }

        for (let k = 0; k < uniqueCount; k++) {
          const rec = slotToRecord[chunkMergedSlots[k]];
          if (!rec) continue;
          hit = testEnemyRayNarrowphase(rec.actor, origin, dir, maxDist, hit);
        }

        // Safe early-out: any enemy not overlapping `[0, segEnd]` lies strictly past `segEnd`
        if (hit && hit.enemy && hit.dist * dirLen + 0.05 < segEnd) {
          break;
        }
      }
    }

    if (telemetry.timingEnabled) {
      telemetry.combatMsAcc += performance.now() - t0;
    }
    return hit && hit.enemy ? hit : null;
  }

  function queryEnemiesInSphere<T extends EnemyActorLike = EnemyActorLike>(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    outActors: T[],
    options?: SphereQueryOptions,
  ): number {
    telemetry.aoeQueryCalls++;
    outActors.length = 0;
    if (!(radius >= 0)) return 0;

    const measure = telemetry.timingEnabled && !options?.skipAutoSync;
    const t0 = measure ? performance.now() : 0;

    if (!telemetry.spatialAccelerated) {
      const list =
        G.enemies && Array.isArray(G.enemies.list) ? G.enemies.list : enemyList;
      for (let i = 0; i < list.length; i++) {
        const en = list[i];
        if (en && en.alive) {
          outActors.push(en as T);
        }
      }
      if (measure) {
        telemetry.combatMsAcc += performance.now() - t0;
      }
      return outActors.length;
    }

    if (!options?.skipAutoSync) {
      ensureEnemiesSynced();
    }
    if (trackedEnemies.length === 0) {
      if (measure) {
        telemetry.combatMsAcc += performance.now() - t0;
      }
      return 0;
    }

    const rPad = radius + 0.05;
    const maxHorizSq = rPad * rPad;
    const minY = options?.ignoreY ? -1024 : cy - rPad - 1.6;
    const maxY = options?.ignoreY ? 1024 : cy + rPad + 1.6;

    const rawCount = dynamicGrid.queryAABB(
      cx - radius,
      minY,
      cz - radius,
      cx + radius,
      maxY,
      cz + radius,
      LAYER_DYNAMIC_ENEMY,
      queryIds,
      querySlots,
    );

    let filteredCount = 0;
    for (let i = 0; i < rawCount; i++) {
      const s = querySlots[i];
      const rec = slotToRecord[s];
      if (!rec || !rec.actor.alive) continue;
      const ecsSlot = rec.entityId & ENTITY_INDEX_MASK;
      const dx = transformCols.x[ecsSlot] - cx;
      const dz = transformCols.z[ecsSlot] - cz;
      if (dx * dx + dz * dz <= maxHorizSq) {
        chunkMergedSlots[filteredCount++] = s;
      }
    }

    if (filteredCount > 1) {
      sortCandidateSlotsByListIndex(chunkMergedSlots, filteredCount);
    }

    for (let i = 0; i < filteredCount; i++) {
      const rec = slotToRecord[chunkMergedSlots[i]];
      if (rec) {
        outActors.push(rec.actor as T);
      }
    }

    if (measure) {
      telemetry.combatMsAcc += performance.now() - t0;
    }
    return outActors.length;
  }

  function recordDamageEvent(
    enemy: EnemyActorLike | null,
    amount: number,
    part?: string,
    killed = false,
  ): void {
    const rec = enemy ? activeRecordByActor.get(enemy) : undefined;
    const eid = rec && world.isAlive(rec.entityId) ? rec.entityId : 0;
    const evSlot = damageEvents.pushSlot();
    if (evSlot !== -1) {
      const evCols = damageEvents.columns;
      evCols.entityId[evSlot] = eid >>> 0;
      evCols.enemyId[evSlot] = enemy ? enemy.id | 0 : 0;
      evCols.amount[evSlot] = Number.isFinite(amount) ? amount : 0;
      evCols.partCode[evSlot] = encodeHitPart(part);
      evCols.killed[evSlot] = killed ? 1 : 0;
    }
    telemetry.damageEventsTotal++;
    dmgCountInWindow++;

    if (rec && world.isAlive(rec.entityId) && enemy) {
      const ecsSlot = rec.entityId & ENTITY_INDEX_MASK;
      healthCols.hp[ecsSlot] = enemy.hp;
      healthCols.alive[ecsSlot] = enemy.alive ? 1 : 0;
      if (!enemy.alive) {
        enemiesDirty = true;
      }
    }
  }

  // Subscribe to G.events if available so all enemy hits/kills populate CombatDamageEvent automatically
  if (G.events && typeof G.events.on === 'function') {
    G.events.on('enemy:hit', (payload?: any) => {
      if (!payload || !payload.enemy) return;
      const en = payload.enemy as EnemyActorLike;
      const killed = !en.alive || en.hp <= 0;
      recordDamageEvent(en, Number(payload.damage || 0), payload.part, killed);
    });
    G.events.on('enemy:killed', () => {
      enemiesDirty = true;
    });
  }

  return {
    world,
    dynamicGrid,
    enemyQuery,
    projectileQuery,
    damageEvents,
    telemetry,

    bindEnemyList(list: EnemyActorLike[]) {
      enemyList = list;
      enemiesDirty = true;
    },

    registerProjectilePool<T = any>(pool: RegisteredProjectilePool<T>) {
      if (registeredPoolNames.has(pool.name)) {
        for (let i = 0; i < projectilePools.length; i++) {
          if (projectilePools[i].spec.name === pool.name) {
            const oldIds = projectilePools[i].entityIds;
            for (let k = 0; k < oldIds.length; k++) {
              if (oldIds[k] !== NULL_ENTITY && world.isAlive(oldIds[k])) {
                world.destroyEntity(oldIds[k]);
              }
            }
            projectilePools[i] = {
              spec: pool,
              entityIds: new Uint32Array(Math.max(1, pool.items.length)),
            };
            refreshEntityCounts();
            return;
          }
        }
      }
      registeredPoolNames.add(pool.name);
      projectilePools.push({
        spec: pool,
        entityIds: new Uint32Array(Math.max(1, pool.items.length)),
      });
    },

    markEnemiesDirty() {
      enemiesDirty = true;
    },

    onEnemySpawn(enemy: EnemyActorLike): EntityId {
      enemiesDirty = true;
      if (!enemy || !enemy.alive) return NULL_ENTITY;
      upsertAliveEnemy(enemy, enemyList.indexOf(enemy));
      refreshEntityCounts();
      return activeRecordByActor.get(enemy)?.entityId ?? NULL_ENTITY;
    },

    onEnemyRetire(enemy: EnemyActorLike) {
      enemiesDirty = true;
      const rec = activeRecordByActor.get(enemy);
      if (!rec) return;
      const idx = trackedEnemies.indexOf(rec);
      if (idx >= 0) {
        destroyEnemyRecordAt(idx);
        refreshEntityCounts();
      }
    },

    onClear() {
      for (let i = trackedEnemies.length - 1; i >= 0; i--) {
        destroyEnemyRecordAt(i);
      }
      for (let p = 0; p < projectilePools.length; p++) {
        const eids = projectilePools[p].entityIds;
        for (let i = 0; i < eids.length; i++) {
          if (eids[i] !== NULL_ENTITY) {
            if (world.isAlive(eids[i])) {
              world.destroyEntity(eids[i]);
            }
            eids[i] = NULL_ENTITY;
          }
        }
      }
      enemiesDirty = false;
      syncedAliveCount = 0;
      refreshEntityCounts();
    },

    syncEnemies,
    syncProjectiles,
    syncAll() {
      syncEnemies();
      syncProjectiles();
    },

    entityOfEnemy(enemy: EnemyActorLike): EntityId {
      const rec = activeRecordByActor.get(enemy);
      return rec && world.isAlive(rec.entityId) ? rec.entityId : NULL_ENTITY;
    },

    raycastEnemies,
    queryEnemiesInSphere,
    recordDamageEvent,

    tickTelemetryWindow(dt: number) {
      if (!(dt > 0)) return;
      dmgSecAcc += dt;
      if (dmgSecAcc >= 0.5) {
        const instRate = dmgCountInWindow / dmgSecAcc;
        telemetry.damageEventsPerSec =
          telemetry.damageEventsPerSec === 0
            ? instRate
            : telemetry.damageEventsPerSec * 0.6 + instRate * 0.4;
        dmgSecAcc = 0;
        dmgCountInWindow = 0;
      }
    },
  };
}
