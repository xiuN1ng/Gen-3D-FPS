import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import {
  ALL_SPATIAL_LAYERS,
  DEFAULT_SPATIAL_CELL_SIZE,
  DEFAULT_SPATIAL_MAX_ITEMS,
  DEFAULT_SPATIAL_MAX_NODES,
  DEFAULT_SPATIAL_MAX_X,
  DEFAULT_SPATIAL_MAX_Z,
  DEFAULT_SPATIAL_MIN_X,
  DEFAULT_SPATIAL_MIN_Z,
  SpatialHashGrid,
  createCapsuleCollisionResult,
  createGroundSampleHit,
  createSpatialRayHit,
} from '../index';

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface OracleItem {
  slot: number;
  id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  mask: number;
  active: boolean;
}

function setOracleBounds(
  item: OracleItem,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): void {
  item.minX = Math.fround(Math.min(minX, maxX));
  item.maxX = Math.fround(Math.max(minX, maxX));
  item.minY = Math.fround(Math.min(minY, maxY));
  item.maxY = Math.fround(Math.max(minY, maxY));
  item.minZ = Math.fround(Math.min(minZ, maxZ));
  item.maxZ = Math.fround(Math.max(minZ, maxZ));
}

function oracleQueryAABB(
  items: readonly OracleItem[],
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  mask: number,
): number[] {
  if ((mask | 0) === 0 || !(minX <= maxX && minY <= maxY && minZ <= maxZ)) return [];
  const qMinX = Math.min(minX, Math.fround(minX));
  const qMaxX = Math.max(maxX, Math.fround(maxX));
  const qMinY = Math.min(minY, Math.fround(minY));
  const qMaxY = Math.max(maxY, Math.fround(maxY));
  const qMinZ = Math.min(minZ, Math.fround(minZ));
  const qMaxZ = Math.max(maxZ, Math.fround(maxZ));
  const hits: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (!b.active) continue;
    if ((b.mask & mask) === 0) continue;
    if (
      qMinX <= b.maxX &&
      qMaxX >= b.minX &&
      qMinY <= b.maxY &&
      qMaxY >= b.minY &&
      qMinZ <= b.maxZ &&
      qMaxZ >= b.minZ
    ) {
      hits.push(b.slot);
    }
  }
  return hits;
}

function oracleQuerySphere(
  items: readonly OracleItem[],
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  mask: number,
): number[] {
  if ((mask | 0) === 0 || !(radius >= 0)) return [];
  const rSq = radius * radius;
  const hits: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (!b.active) continue;
    if ((b.mask & mask) === 0) continue;
    const dx = cx < b.minX ? b.minX - cx : cx > b.maxX ? cx - b.maxX : 0;
    const dy = cy < b.minY ? b.minY - cy : cy > b.maxY ? cy - b.maxY : 0;
    const dz = cz < b.minZ ? b.minZ - cz : cz > b.maxZ ? cz - b.maxZ : 0;
    if (dx * dx + dy * dy + dz * dz <= rSq) {
      hits.push(b.slot);
    }
  }
  return hits;
}

function oracleQueryCapsule(
  items: readonly OracleItem[],
  x: number,
  baseY: number,
  z: number,
  radius: number,
  height: number,
  mask: number,
): number[] {
  if ((mask | 0) === 0 || !(radius >= 0) || !(height >= 0)) return [];
  const segY0 = baseY + radius;
  const segY1 = baseY + Math.max(radius, height - radius);
  const rSq = radius * radius;
  const hits: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (!b.active) continue;
    if ((b.mask & mask) === 0) continue;
    const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
    const dy = segY1 < b.minY ? b.minY - segY1 : segY0 > b.maxY ? segY0 - b.maxY : 0;
    const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
    if (dx * dx + dy * dy + dz * dz <= rSq) {
      hits.push(b.slot);
    }
  }
  return hits;
}

function oracleSampleGroundHeight(
  items: readonly OracleItem[],
  x: number,
  z: number,
  maxY: number,
  defaultGroundY: number,
  mask: number,
): { found: boolean; groundY: number; id: number; slot: number } {
  if ((mask | 0) === 0) {
    return { found: false, groundY: defaultGroundY, id: 0, slot: -1 };
  }
  const xLo = Math.min(x, Math.fround(x));
  const xHi = Math.max(x, Math.fround(x));
  const zLo = Math.min(z, Math.fround(z));
  const zHi = Math.max(z, Math.fround(z));
  const maxYBound = Math.max(maxY, Math.fround(maxY));

  let bestY = -Infinity;
  let bestSlot = -1;
  let bestId = 0;

  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (!b.active) continue;
    if ((b.mask & mask) === 0) continue;
    if (xHi >= b.minX && xLo <= b.maxX && zHi >= b.minZ && zLo <= b.maxZ) {
      if (b.maxY <= maxYBound && b.maxY > bestY) {
        bestY = b.maxY;
        bestSlot = b.slot;
        bestId = b.id;
      }
    }
  }

  if (bestSlot === -1) {
    return { found: false, groundY: defaultGroundY, id: 0, slot: -1 };
  }
  return { found: true, groundY: bestY, id: bestId, slot: bestSlot };
}

function oracleRaycastAABB(
  items: readonly OracleItem[],
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  mask: number,
  ignoreInsideOrigin = true,
  ignoreId?: number,
) {
  const miss = createSpatialRayHit();
  if ((mask | 0) === 0 || !(maxDist >= 0)) return miss;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (!(lenSq > 0)) return miss;

  let ux = dx;
  let uy = dy;
  let uz = dz;
  if (Math.abs(lenSq - 1) > 1e-12) {
    const inv = 1 / Math.sqrt(lenSq);
    ux *= inv;
    uy *= inv;
    uz *= inv;
  }

  const xPar = Math.abs(ux) < 1e-15;
  const yPar = Math.abs(uy) < 1e-15;
  const zPar = Math.abs(uz) < 1e-15;
  const invUx = xPar ? 0 : 1 / ux;
  const invUy = yPar ? 0 : 1 / uy;
  const invUz = zPar ? 0 : 1 / uz;

  let bestDist = maxDist;
  let bestItem: OracleItem | null = null;
  let bestNx = 0;
  let bestNy = 0;
  let bestNz = 0;

  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (!b.active) continue;
    if ((b.mask & mask) === 0) continue;
    if (ignoreId !== undefined && b.id === ignoreId) continue;

    if (xPar && (ox < b.minX || ox > b.maxX)) continue;
    if (yPar && (oy < b.minY || oy > b.maxY)) continue;
    if (zPar && (oz < b.minZ || oz > b.maxZ)) continue;

    let tEnter = -Infinity;
    let tExit = Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    if (!xPar) {
      const tx0 = (ux > 0 ? b.minX - ox : b.maxX - ox) * invUx;
      const tx1 = (ux > 0 ? b.maxX - ox : b.minX - ox) * invUx;
      if (tx0 > tEnter) {
        tEnter = tx0;
        nx = ux > 0 ? -1 : 1;
        ny = 0;
        nz = 0;
      }
      if (tx1 < tExit) tExit = tx1;
    }

    if (!yPar) {
      const ty0 = (uy > 0 ? b.minY - oy : b.maxY - oy) * invUy;
      const ty1 = (uy > 0 ? b.maxY - oy : b.minY - oy) * invUy;
      if (ty0 > tEnter) {
        tEnter = ty0;
        nx = 0;
        ny = uy > 0 ? -1 : 1;
        nz = 0;
      }
      if (ty1 < tExit) tExit = ty1;
    }

    if (!zPar) {
      const tz0 = (uz > 0 ? b.minZ - oz : b.maxZ - oz) * invUz;
      const tz1 = (uz > 0 ? b.maxZ - oz : b.minZ - oz) * invUz;
      if (tz0 > tEnter) {
        tEnter = tz0;
        nx = 0;
        ny = 0;
        nz = uz > 0 ? -1 : 1;
      }
      if (tz1 < tExit) tExit = tz1;
    }

    if (tExit < tEnter || tExit < 0) continue;
    if (ignoreInsideOrigin && tEnter < 0) continue;
    const tHit = tEnter < 0 ? 0 : tEnter;
    if (tHit < bestDist || (tHit === bestDist && bestItem === null)) {
      bestDist = tHit;
      bestItem = b;
      bestNx = nx;
      bestNy = ny;
      bestNz = nz;
    }
  }

  if (bestItem === null) return miss;
  return {
    hit: true,
    id: bestItem.id,
    slot: bestItem.slot,
    distance: bestDist,
    pointX: ox + bestDist * ux,
    pointY: oy + bestDist * uy,
    pointZ: oz + bestDist * uz,
    normalX: bestNx,
    normalY: bestNy,
    normalZ: bestNz,
  };
}

describe('SpatialHashGrid — Configuration, Contracts & Source Purity', () => {
  it('initializes default Hanamura-scale configuration and result factories accurately', () => {
    const grid = new SpatialHashGrid();
    assert.equal(grid.minX, DEFAULT_SPATIAL_MIN_X);
    assert.equal(grid.maxX, DEFAULT_SPATIAL_MAX_X);
    assert.equal(grid.minZ, DEFAULT_SPATIAL_MIN_Z);
    assert.equal(grid.maxZ, DEFAULT_SPATIAL_MAX_Z);
    assert.equal(grid.cellSize, DEFAULT_SPATIAL_CELL_SIZE);
    assert.equal(grid.cols, 48);
    assert.equal(grid.rows, 48);
    assert.equal(grid.maxItems, DEFAULT_SPATIAL_MAX_ITEMS);
    assert.equal(grid.maxNodes, DEFAULT_SPATIAL_MAX_NODES);
    assert.equal(grid.itemCount, 0);
    assert.equal(grid.activeCount, 0);
    assert.equal(grid.nodeCount, 0);
    assert.equal(grid.overflowCount, 0);

    const custom = new SpatialHashGrid({
      minX: -10,
      maxX: 11,
      minZ: -5,
      maxZ: 8,
      cellSize: 4,
      maxItems: 64,
      maxNodes: 256,
    });
    assert.equal(custom.cols, 6);
    assert.equal(custom.rows, 4);
    assert.equal(custom.maxItems, 64);
    assert.equal(custom.maxNodes, 256);

    const rayHit = createSpatialRayHit();
    assert.deepEqual(rayHit, {
      hit: false,
      id: 0,
      slot: -1,
      distance: 0,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 0,
      normalZ: 0,
    });

    const groundHit = createGroundSampleHit();
    assert.deepEqual(groundHit, { found: false, groundY: 0, id: 0, slot: -1 });

    const capRes = createCapsuleCollisionResult();
    assert.deepEqual(capRes, {
      collided: false,
      grounded: false,
      resolvedX: 0,
      resolvedBaseY: 0,
      resolvedZ: 0,
      normalX: 0,
      normalY: 0,
      normalZ: 0,
      hitCount: 0,
    });
  });

  it('throws RangeError on invalid SpatialGridConfig parameters', () => {
    assert.throws(() => new SpatialHashGrid({ cellSize: 0 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ cellSize: -2 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ cellSize: Number.NaN }), RangeError);
    assert.throws(() => new SpatialHashGrid({ minX: 10, maxX: 10 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ minX: 20, maxX: -20 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ minZ: 5, maxZ: 5 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ minZ: 15, maxZ: -15 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ maxItems: 0 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ maxItems: -10 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ maxItems: 3.5 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ maxNodes: 0 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ maxNodes: -1 }), RangeError);
    assert.throws(() => new SpatialHashGrid({ maxNodes: Number.POSITIVE_INFINITY }), RangeError);
  });

  it('maintains 100% runtime purity with zero DOM, Three.js, React, game, or ts-ignore usage', () => {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const spatialRoot = path.resolve(thisDir, '..');
    const sourceFiles = ['SpatialHashGrid.ts', 'index.ts'];

    for (const fileName of sourceFiles) {
      const fullPath = path.join(spatialRoot, fileName);
      const source = fs.readFileSync(fullPath, 'utf8');

      assert.doesNotMatch(source, /from\s+['"]three/i, `${fileName} must not import three`);
      assert.doesNotMatch(source, /from\s+['"]react/i, `${fileName} must not import react`);
      assert.doesNotMatch(source, /src\/game|\.\.\/\.\.\/game/i, `${fileName} must not reference game layer`);
      assert.doesNotMatch(source, /\b(window|document|navigator|HTMLElement|HTMLCanvasElement)\b/, `${fileName} must not use DOM globals`);
      assert.doesNotMatch(source, /@ts-(nocheck|ignore|expect-error)/, `${fileName} must not suppress TypeScript checks`);
    }
  });
});

describe('SpatialHashGrid — Seeded PRNG Fuzz Parity vs Brute-Force Oracle', () => {
  it('matches brute-force oracle across 750 static AABBs + 300 dynamic shapes and 2,600+ queries/rays', () => {
    const rng = createRng(2026);
    const grid = new SpatialHashGrid({
      minX: -96,
      maxX: 96,
      minZ: -96,
      maxZ: 96,
      cellSize: 4.0,
      maxItems: 2048,
      maxNodes: 32768,
    });
    const oracle: OracleItem[] = [];

    const addBox = (
      id: number,
      minX: number,
      minY: number,
      minZ: number,
      maxX: number,
      maxY: number,
      maxZ: number,
      mask: number,
    ) => {
      const slot = grid.insertAABB(id, minX, minY, minZ, maxX, maxY, maxZ, mask);
      assert.notEqual(slot, -1, 'expected sufficient capacity during fuzz setup');
      const item: OracleItem = {
        slot,
        id,
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 0,
        maxY: 0,
        maxZ: 0,
        mask: mask >>> 0,
        active: true,
      };
      setOracleBounds(item, minX, minY, minZ, maxX, maxY, maxZ);
      oracle.push(item);
    };

    // 1. Insert 750 Hanamura-scale static AABBs: perimeter slabs, thin walls, stairs, roofs, negative sea pits, straddling boxes.
    addBox(1000, -76, -2.2, -52, -74, 25.5, 52, 0b0001_0111); // 104m west boundary slab
    addBox(1001, 76, -2.2, -52, 78, 25.5, 52, 0b0001_0111); // 104m east boundary slab
    addBox(1002, -76, -2.2, -53, 78, 25.5, -51, 0b0001_0111); // 154m north boundary slab
    addBox(1003, -76, -2.2, 51, 78, 25.5, 53, 0b0001_0111); // 154m south boundary slab
    addBox(1004, -92, -4.0, -88, -84, -1.6, -80, 0b0000_0001); // negative corner sea pit
    addBox(1005, -18, 24.0, -14, 18, 28.5, 14, 0b0000_0111); // elevated castle roof y=28.5m
    addBox(1006, -102, 0, -12, -90, 6, 12, 0b0000_0011); // straddling west grid border [-102, -90]

    for (let i = oracle.length; i < 750; i++) {
      const id = 1000 + i;
      const kind = i % 5;
      const mask = 1 << (i % 5);
      if (kind === 0) {
        // Thin architectural wall
        const x = (rng() * 170) - 85;
        const z = (rng() * 150) - 75;
        const y0 = (rng() * 8) - 2;
        const h = 2.5 + rng() * 6.0;
        const len = 2.0 + rng() * 14.0;
        if (rng() < 0.5) {
          addBox(id, x, y0, z, x + 0.25, y0 + h, z + len, mask | 0b11);
        } else {
          addBox(id, x, y0, z, x + len, y0 + h, z + 0.25, mask | 0b11);
        }
      } else if (kind === 1) {
        // Ground / terrace / sunken floor slab
        const cx = (rng() * 176) - 88;
        const cz = (rng() * 176) - 88;
        const hw = 2 + rng() * 10;
        const hd = 2 + rng() * 10;
        const topY = (rng() * 16) - 3.5;
        addBox(id, cx - hw, topY - 1.0, cz - hd, cx + hw, topY, cz + hd, mask | 0b101);
      } else if (kind === 2) {
        // Elevated castle roof / pagoda tier
        const cx = (rng() * 140) - 70;
        const cz = (rng() * 120) - 60;
        const hw = 1.5 + rng() * 6;
        const hd = 1.5 + rng() * 6;
        const baseY = 10 + rng() * 22;
        addBox(id, cx - hw, baseY, cz - hd, cx + hw, baseY + 0.8 + rng() * 2.5, cz + hd, mask | 0b111);
      } else if (kind === 3) {
        // Stone stair step box
        const x = (rng() * 150) - 75;
        const z = (rng() * 130) - 65;
        const y = rng() * 6;
        addBox(id, x, y, z, x + 1.2, y + 0.25, z + 2.8, mask | 0b111);
      } else {
        // General pillar / prop collider
        const x = (rng() * 184) - 92;
        const z = (rng() * 184) - 92;
        const y = (rng() * 12) - 1;
        const sx = 0.4 + rng() * 3.5;
        const sy = 0.6 + rng() * 5.0;
        const sz = 0.4 + rng() * 3.5;
        addBox(id, x, y, z, x + sx, y + sy, z + sz, mask | 0b11111);
      }
    }

    // 2. Insert 300 dynamic spheres and capsules.
    for (let i = 0; i < 300; i++) {
      const id = 5000 + i;
      const mask = 0b1000 | (1 << (i % 4));
      const x = (rng() * 180) - 90;
      const y = (rng() * 20) - 1;
      const z = (rng() * 180) - 90;

      if (i % 2 === 0) {
        const radius = 0.2 + rng() * 2.8;
        const slot = grid.insertSphere(id, x, y, z, radius, mask);
        assert.notEqual(slot, -1);
        const item: OracleItem = {
          slot,
          id,
          minX: 0,
          minY: 0,
          minZ: 0,
          maxX: 0,
          maxY: 0,
          maxZ: 0,
          mask,
          active: true,
        };
        setOracleBounds(item, x - radius, y - radius, z - radius, x + radius, y + radius, z + radius);
        oracle.push(item);
      } else {
        const radius = 0.25 + rng() * 0.9;
        const height = i % 7 === 0 ? radius * 1.2 : 1.4 + rng() * 2.4; // include degenerate short capsules
        const slot = grid.insertCapsule(id, x, y, z, radius, height, mask);
        assert.notEqual(slot, -1);
        const topY = y + Math.max(2 * radius, height);
        const item: OracleItem = {
          slot,
          id,
          minX: 0,
          minY: 0,
          minZ: 0,
          maxX: 0,
          maxY: 0,
          maxZ: 0,
          mask,
          active: true,
        };
        setOracleBounds(item, x - radius, y, z - radius, x + radius, topY, z + radius);
        oracle.push(item);
      }
    }

    assert.equal(grid.itemCount, 1050);
    assert.equal(grid.activeCount, 1050);

    // Mutate ~35 dynamic items via updateAABB and tombstone ~35 items before fuzzing queries.
    for (let i = 0; i < 35; i++) {
      const targetSlot = 750 + i * 4;
      const nx = (rng() * 170) - 85;
      const ny = rng() * 14;
      const nz = (rng() * 170) - 85;
      const ok = grid.updateAABB(targetSlot, nx - 1.2, ny, nz - 1.2, nx + 1.2, ny + 2.2, nz + 1.2);
      assert.equal(ok, true);
      setOracleBounds(oracle[targetSlot], nx - 1.2, ny, nz - 1.2, nx + 1.2, ny + 2.2, nz + 1.2);
    }

    for (let i = 0; i < 35; i++) {
      const disableSlotIdx = 50 + i * 25;
      if (i % 2 === 0) {
        assert.equal(grid.disableSlot(disableSlotIdx), true);
        oracle[disableSlotIdx].active = false;
      } else {
        const targetId = oracle[disableSlotIdx].id;
        const removed = grid.disableById(targetId);
        assert.equal(removed, 1);
        oracle[disableSlotIdx].active = false;
      }
    }

    assert.equal(grid.activeCount, 1015);

    const outIds = new Uint32Array(2048);
    const outSlots = new Int32Array(2048);
    const outGround = createGroundSampleHit();
    const outRay = createSpatialRayHit();

    // 3. 500 random queryAABB checks.
    for (let q = 0; q < 500; q++) {
      const cx = (rng() * 210) - 105;
      const cy = (rng() * 36) - 4;
      const cz = (rng() * 210) - 105;
      const hx = 0.5 + rng() * 18;
      const hy = 0.5 + rng() * 10;
      const hz = 0.5 + rng() * 18;
      const mask = q % 19 === 0 ? ALL_SPATIAL_LAYERS : (1 + ((rng() * 31) | 0));

      const count = grid.queryAABB(
        cx - hx,
        cy - hy,
        cz - hz,
        cx + hx,
        cy + hy,
        cz + hz,
        mask,
        outIds,
        outSlots,
      );
      const expectedSlots = oracleQueryAABB(
        oracle,
        cx - hx,
        cy - hy,
        cz - hz,
        cx + hx,
        cy + hy,
        cz + hz,
        mask,
      );

      const actualSlots = Array.from(outSlots.subarray(0, count)).sort((a, b) => a - b);
      assert.deepEqual(actualSlots, expectedSlots, `queryAABB mismatch at q=${q}`);

      const actualIds = Array.from(outIds.subarray(0, count)).sort((a, b) => a - b);
      const expectedIds = expectedSlots.map((s) => oracle[s].id).sort((a, b) => a - b);
      assert.deepEqual(actualIds, expectedIds, `queryAABB id mismatch at q=${q}`);
    }

    // 4. 500 random querySphere checks.
    for (let q = 0; q < 500; q++) {
      const cx = (rng() * 204) - 102;
      const cy = (rng() * 34) - 3;
      const cz = (rng() * 204) - 102;
      const radius = q % 25 === 0 ? 0 : 0.25 + rng() * 15;
      const mask = 1 + ((rng() * 31) | 0);

      const count = grid.querySphere(cx, cy, cz, radius, mask, outIds, outSlots);
      const expectedSlots = oracleQuerySphere(oracle, cx, cy, cz, radius, mask);
      const actualSlots = Array.from(outSlots.subarray(0, count)).sort((a, b) => a - b);
      assert.deepEqual(actualSlots, expectedSlots, `querySphere mismatch at q=${q}`);
    }

    // 5. 500 random queryCapsule checks.
    for (let q = 0; q < 500; q++) {
      const x = (rng() * 200) - 100;
      const baseY = (rng() * 30) - 3;
      const z = (rng() * 200) - 100;
      const radius = 0.2 + rng() * 4.5;
      const height = q % 9 === 0 ? radius * 0.8 : 1.0 + rng() * 6.0;
      const mask = 1 + ((rng() * 31) | 0);

      const count = grid.queryCapsule(x, baseY, z, radius, height, mask, outIds, outSlots);
      const expectedSlots = oracleQueryCapsule(oracle, x, baseY, z, radius, height, mask);
      const actualSlots = Array.from(outSlots.subarray(0, count)).sort((a, b) => a - b);
      assert.deepEqual(actualSlots, expectedSlots, `queryCapsule mismatch at q=${q}`);
    }

    // 6. 500 random sampleGroundHeight checks.
    for (let q = 0; q < 500; q++) {
      const x = (rng() * 204) - 102;
      const z = (rng() * 204) - 102;
      const maxY = (rng() * 36) - 2;
      const defaultY = -99.5;
      const mask = 1 + ((rng() * 31) | 0);

      const res = grid.sampleGroundHeight(x, z, maxY, defaultY, mask, outGround);
      const expected = oracleSampleGroundHeight(oracle, x, z, maxY, defaultY, mask);
      assert.equal(res, outGround);
      assert.equal(res.found, expected.found, `sampleGroundHeight found mismatch at q=${q}`);
      assert.equal(res.slot, expected.slot, `sampleGroundHeight slot mismatch at q=${q}`);
      assert.equal(res.id, expected.id, `sampleGroundHeight id mismatch at q=${q}`);
      assert.ok(Math.abs(res.groundY - expected.groundY) <= 1e-6, `sampleGroundHeight groundY mismatch at q=${q}`);
    }

    // 7. 600 raycastAABB checks covering random 3D, axis-aligned, vertical, 180m diagonal, 45-deg vertex-crossing, outside-grid, ignoreInsideOrigin, and ignoreId.
    for (let r = 0; r < 600; r++) {
      let ox: number;
      let oy: number;
      let oz: number;
      let dx: number;
      let dy: number;
      let dz: number;
      let maxDist = 20 + rng() * 180;
      let ignoreInsideOrigin = true;
      let ignoreId: number | undefined;
      const mask = r % 7 === 0 ? ALL_SPATIAL_LAYERS : (1 + ((rng() * 31) | 0));

      const mode = r % 8;
      if (mode === 0) {
        // Axis-aligned along X (dz = 0)
        ox = (rng() * 190) - 95;
        oy = (rng() * 24) - 1;
        oz = (rng() * 190) - 95;
        dx = rng() < 0.5 ? 1 : -1;
        dy = (rng() - 0.5) * 0.2;
        dz = 0;
      } else if (mode === 1) {
        // Axis-aligned along Z (dx = 0)
        ox = (rng() * 190) - 95;
        oy = (rng() * 24) - 1;
        oz = (rng() * 190) - 95;
        dx = 0;
        dy = (rng() - 0.5) * 0.2;
        dz = rng() < 0.5 ? 1 : -1;
      } else if (mode === 2) {
        // Pure vertical ray (dx = 0, dz = 0)
        ox = (rng() * 180) - 90;
        oy = rng() < 0.5 ? 35 : -5;
        oz = (rng() * 180) - 90;
        dx = 0;
        dy = oy > 0 ? -1 : 1;
        dz = 0;
        maxDist = 60;
      } else if (mode === 3) {
        // Long-range 180m+ diagonal & exact 45-deg grid-vertex crossing rays
        if (r % 16 === 3) {
          ox = 0;
          oy = 2 + rng() * 8;
          oz = 0;
          dx = rng() < 0.5 ? 1 : -1;
          dy = 0;
          dz = rng() < 0.5 ? 1 : -1;
        } else {
          ox = -88 + rng() * 16;
          oy = 1 + rng() * 18;
          oz = -88 + rng() * 16;
          dx = 1;
          dy = (rng() - 0.5) * 0.15;
          dz = 0.8 + rng() * 0.4;
        }
        maxDist = 220;
      } else if (mode === 4) {
        // Outside-grid origin shooting inward (or grazing past)
        ox = rng() < 0.5 ? -130 : 130;
        oy = rng() * 16;
        oz = (rng() * 220) - 110;
        dx = ox < 0 ? 1 : -1;
        dy = (rng() - 0.5) * 0.1;
        dz = (rng() - 0.5) * 0.8;
        maxDist = 260;
      } else if (mode === 5) {
        // Inside-collider origin testing ignoreInsideOrigin = false vs true
        const host = oracle[(r * 13) % oracle.length];
        ox = 0.5 * (host.minX + host.maxX);
        oy = 0.5 * (host.minY + host.maxY);
        oz = 0.5 * (host.minZ + host.maxZ);
        dx = rng() - 0.5;
        dy = (rng() - 0.5) * 0.5;
        dz = rng() - 0.5;
        if (dx === 0 && dy === 0 && dz === 0) dx = 1;
        ignoreInsideOrigin = r % 16 === 5;
      } else if (mode === 6) {
        // Shooter self-ignore via ignoreId
        const shooter = oracle[750 + (r % 250)];
        ox = 0.5 * (shooter.minX + shooter.maxX);
        oy = 0.5 * (shooter.minY + shooter.maxY);
        oz = 0.5 * (shooter.minZ + shooter.maxZ);
        dx = rng() - 0.5;
        dy = (rng() - 0.5) * 0.4;
        dz = rng() - 0.5;
        if (dx === 0 && dy === 0 && dz === 0) dz = 1;
        ignoreInsideOrigin = false;
        ignoreId = shooter.id;
      } else {
        // Arbitrary 3D direction
        ox = (rng() * 190) - 95;
        oy = (rng() * 28) - 2;
        oz = (rng() * 190) - 95;
        dx = rng() * 2 - 1;
        dy = rng() * 2 - 1;
        dz = rng() * 2 - 1;
        if (dx === 0 && dy === 0 && dz === 0) dx = 1;
      }

      const hit = grid.raycastAABB(ox, oy, oz, dx, dy, dz, maxDist, mask, outRay, {
        ignoreInsideOrigin,
        ignoreId,
      });
      const expected = oracleRaycastAABB(
        oracle,
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        maxDist,
        mask,
        ignoreInsideOrigin,
        ignoreId,
      );

      assert.equal(hit, expected.hit, `raycastAABB hit mismatch at r=${r} (mode=${mode})`);
      assert.equal(outRay.hit, expected.hit);
      if (expected.hit) {
        assert.ok(
          Math.abs(outRay.distance - expected.distance) <= 1e-4,
          `raycastAABB distance mismatch at r=${r}: got ${outRay.distance}, expected ${expected.distance}`,
        );
        if (Math.abs(outRay.distance - expected.distance) <= 1e-9) {
          assert.equal(outRay.slot, expected.slot, `raycastAABB slot mismatch at r=${r}`);
          assert.equal(outRay.id, expected.id, `raycastAABB id mismatch at r=${r}`);
          assert.equal(outRay.normalX, expected.normalX, `raycastAABB normalX mismatch at r=${r}`);
          assert.equal(outRay.normalY, expected.normalY, `raycastAABB normalY mismatch at r=${r}`);
          assert.equal(outRay.normalZ, expected.normalZ, `raycastAABB normalZ mismatch at r=${r}`);
        }
        assert.ok(Math.abs(outRay.pointX - expected.pointX) <= 1e-3);
        assert.ok(Math.abs(outRay.pointY - expected.pointY) <= 1e-3);
        assert.ok(Math.abs(outRay.pointZ - expected.pointZ) <= 1e-3);
      } else {
        assert.equal(outRay.slot, -1);
      }
    }
  });
});

describe('SpatialHashGrid — Multi-Cell Deduplication, Stamp Wrap, Tombstones & updateAABB', () => {
  it('deduplicates a 36-cell AABB across 70,000+ consecutive queries and explicit 0xffffffff stamp wrap-around', () => {
    const grid = new SpatialHashGrid();
    // [-10, 10] x [-10, 10] spans cells 21..26 x 21..26 = 6x6 = 36 cells at cellSize=4 on [-96, 96]
    const slot = grid.insertAABB(777, -10, 0, -10, 10, 5, 10, ALL_SPATIAL_LAYERS);
    assert.equal(slot, 0);
    assert.equal(grid.nodeCount, 36);

    const outIds = new Uint32Array(16);
    const rayHit = createSpatialRayHit();

    for (let i = 0; i < 70_050; i++) {
      const m = i & 3;
      if (m === 0) {
        const c = grid.queryAABB(-12, -1, -12, 12, 6, 12, ALL_SPATIAL_LAYERS, outIds);
        assert.equal(c, 1, `duplicate or missing hit in queryAABB at i=${i}`);
        assert.equal(outIds[0], 777);
      } else if (m === 1) {
        const c = grid.querySphere(0, 2.5, 0, 15, ALL_SPATIAL_LAYERS, outIds);
        assert.equal(c, 1, `duplicate or missing hit in querySphere at i=${i}`);
        assert.equal(outIds[0], 777);
      } else if (m === 2) {
        const c = grid.queryCapsule(0, 0, 0, 14, 4, ALL_SPATIAL_LAYERS, outIds);
        assert.equal(c, 1, `duplicate or missing hit in queryCapsule at i=${i}`);
        assert.equal(outIds[0], 777);
      } else {
        const hit = grid.raycastAABB(-20, 2, -20, 1, 0, 1, 60, ALL_SPATIAL_LAYERS, rayHit);
        assert.equal(hit, true, `missing ray hit at i=${i}`);
        assert.equal(rayHit.id, 777);
      }
    }

    // Explicit stamp wrap-around test near 0xffffffff
    const internal = grid as unknown as { queryStamp: number; itemStamp: Uint32Array };
    internal.queryStamp = 0xfffffffd;

    for (let step = 0; step < 8; step++) {
      const count = grid.queryAABB(-10, 0, -10, 10, 5, 10, ALL_SPATIAL_LAYERS, outIds);
      assert.equal(count, 1, `stamp wrap failed at step=${step}`);
      assert.equal(outIds[0], 777);
    }
    assert.ok(internal.queryStamp > 0 && internal.queryStamp < 16, 'expected queryStamp to wrap cleanly to small positive int');
  });

  it('handles O(1) tombstones (disableSlot / disableById) and mid-tick raycast pass-through without clear()', () => {
    const grid = new SpatialHashGrid();
    const frontWallSlot = grid.insertAABB(101, 4, 0, -4, 5, 4, 4, 0b01);
    const backTargetSlot = grid.insertAABB(202, 12, 0, -4, 13, 4, 4, 0b01);
    const twinA = grid.insertAABB(303, -20, 0, -2, -18, 2, 2, 0b10);
    const twinB = grid.insertAABB(303, -16, 0, -2, -14, 2, 2, 0b10);

    assert.equal(grid.isSlotActive(frontWallSlot), true);
    assert.equal(grid.isSlotActive(-1), false);
    assert.equal(grid.isSlotActive(99), false);
    assert.equal(grid.activeCount, 4);

    const hit = createSpatialRayHit();
    assert.equal(grid.raycastAABB(0, 2, 0, 1, 0, 0, 50, 0b01, hit), true);
    assert.equal(hit.id, 101);
    assert.equal(hit.slot, frontWallSlot);

    // Destroy front destructible wall via disableSlot
    assert.equal(grid.disableSlot(frontWallSlot), true);
    assert.equal(grid.disableSlot(frontWallSlot), false); // idempotent
    assert.equal(grid.isSlotActive(frontWallSlot), false);
    assert.equal(grid.activeCount, 3);
    assert.equal(grid.itemCount, 4); // slot indices remain stable

    // Ray immediately passes through to backTarget without rebuilding grid
    assert.equal(grid.raycastAABB(0, 2, 0, 1, 0, 0, 50, 0b01, hit), true);
    assert.equal(hit.id, 202);
    assert.equal(hit.slot, backTargetSlot);

    // disableById disables all matching active slots
    assert.equal(grid.disableById(303), 2);
    assert.equal(grid.disableById(303), 0);
    assert.equal(grid.isSlotActive(twinA), false);
    assert.equal(grid.isSlotActive(twinB), false);
    assert.equal(grid.activeCount, 1);
  });

  it('updates AABB bounds across cells via updateAABB without stale cell leaks or node pool exhaustion', () => {
    const grid = new SpatialHashGrid({ maxItems: 16, maxNodes: 64 });
    const slot = grid.insertAABB(55, -2, 0, -2, 2, 2, 2, 1); // spans cells (23..24)x(23..24) = 4 nodes
    assert.equal(grid.nodeCount, 4);

    const outIds = new Uint32Array(8);
    assert.equal(grid.queryAABB(-1, 0, -1, 1, 2, 1, 1, outIds), 1);

    // Move across 1,000 distinct positions including outside-grid and multi-cell spans; node pool (64) must recycle cleanly!
    for (let step = 0; step < 1000; step++) {
      const cx = -100 + (step % 50) * 4.1;
      const cz = -90 + ((step * 7) % 45) * 4.1;
      const ok = grid.updateAABB(slot, cx - 2.5, 0, cz - 2.5, cx + 2.5, 3, cz + 2.5);
      assert.equal(ok, true);
      assert.ok(grid.nodeCount <= 9, `expected recycled node count <= 9, got ${grid.nodeCount}`);
    }

    // Final placement at [40, 42] x [40, 42]
    assert.equal(grid.updateAABB(slot, 40, 0, 40, 42, 3, 42), true);

    // Zero stale hits at origin or intermediate locations
    assert.equal(grid.queryAABB(-4, -1, -4, 4, 4, 4, 1, outIds), 0);
    assert.equal(grid.querySphere(0, 1, 0, 8, 1, outIds), 0);

    // Exact single hit at new location
    assert.equal(grid.queryAABB(39, 0, 39, 43, 3, 43, 1, outIds), 1);
    assert.equal(outIds[0], 55);

    // Updating disabled or out-of-range slot returns false
    grid.disableSlot(slot);
    assert.equal(grid.updateAABB(slot, 0, 0, 0, 1, 1, 1), false);
    assert.equal(grid.updateAABB(999, 0, 0, 0, 1, 1, 1), false);
  });

  it('handles maxItems and maxNodes capacity overflow gracefully without corrupting state', () => {
    const itemCapGrid = new SpatialHashGrid({ maxItems: 3, maxNodes: 64 });
    assert.equal(itemCapGrid.insertAABB(1, 0, 0, 0, 1, 1, 1), 0);
    assert.equal(itemCapGrid.insertAABB(2, 2, 0, 0, 3, 1, 1), 1);
    assert.equal(itemCapGrid.insertAABB(3, 4, 0, 0, 5, 1, 1), 2);
    assert.equal(itemCapGrid.insertAABB(4, 6, 0, 0, 7, 1, 1), -1);
    assert.equal(itemCapGrid.insertSphere(5, 8, 0, 0, 1), -1);
    assert.equal(itemCapGrid.overflowCount, 2);
    assert.equal(itemCapGrid.itemCount, 3);
    assert.equal(itemCapGrid.activeCount, 3);

    itemCapGrid.clear();
    assert.equal(itemCapGrid.overflowCount, 0);
    assert.equal(itemCapGrid.itemCount, 0);

    // Node capacity overflow: 6x6 cell box needs 36 nodes > maxNodes=10
    const nodeCapGrid = new SpatialHashGrid({ maxItems: 16, maxNodes: 10 });
    const smallSlot = nodeCapGrid.insertAABB(10, 1, 0, 1, 2, 2, 2); // 1 cell = 1 node
    assert.equal(smallSlot, 0);
    assert.equal(nodeCapGrid.nodeCount, 1);

    const hugeSlot = nodeCapGrid.insertAABB(11, -10, 0, -10, 10, 2, 10); // 36 nodes -> overflow
    assert.equal(hugeSlot, -1);
    assert.equal(nodeCapGrid.overflowCount, 1);
    assert.equal(nodeCapGrid.itemCount, 1);
    assert.equal(nodeCapGrid.nodeCount, 1);

    // Expanding existing item beyond maxNodes via updateAABB fails atomically and preserves original bounds
    assert.equal(nodeCapGrid.updateAABB(smallSlot, -10, 0, -10, 10, 2, 10), false);
    assert.equal(nodeCapGrid.overflowCount, 2);
    const out = new Uint32Array(4);
    assert.equal(nodeCapGrid.queryAABB(1, 0, 1, 2, 2, 2, ALL_SPATIAL_LAYERS, out), 1);
    assert.equal(out[0], 10);
  });
});

describe('SpatialHashGrid — resolveCapsuleStatic Character Physics Solver', () => {
  it('resolves horizontal wall slide while preserving tangential motion', () => {
    const grid = new SpatialHashGrid();
    grid.insertAABB(1, -20, -1, -20, 20, 0, 20, 1); // floor at y=0
    grid.insertAABB(2, 2.0, 0, -10, 3.0, 4.0, 10, 1); // X-wall starting at x=2.0

    const res = createCapsuleCollisionResult();
    // Capsule (r=0.32, h=1.8) moved diagonally to (1.82, 0, 3.5) -> penetrates wall by 0.14m along X
    grid.resolveCapsuleStatic(1.82, 0, 3.5, 0.32, 1.8, 1, res);

    assert.equal(res.collided, true);
    assert.equal(res.grounded, true);
    assert.ok(Math.abs(res.resolvedX - 1.68) <= 1e-4, `expected resolvedX ~ 1.68, got ${res.resolvedX}`);
    assert.ok(Math.abs(res.resolvedBaseY - 0) <= 1e-5);
    assert.ok(Math.abs(res.resolvedZ - 3.5) <= 1e-5, 'expected tangential Z motion to slide unimpeded');
    assert.ok(Math.abs(res.normalX - -1) <= 1e-4);
    assert.equal(res.normalY, 0);
    assert.equal(res.normalZ, 0);
    assert.equal(res.hitCount, 1);
  });

  it('pushes capsule cleanly out of concave 2-wall corners and convex box corners', () => {
    const grid = new SpatialHashGrid();
    grid.insertAABB(1, 2.0, 0, -10, 3.0, 4.0, 10, 1); // East wall x >= 2
    grid.insertAABB(2, -10, 0, 2.0, 10, 4.0, 3.0, 1); // South wall z >= 2
    grid.insertAABB(3, -6.0, 0, -6.0, -4.0, 4.0, -4.0, 1); // Standalone pillar

    const res = createCapsuleCollisionResult();
    // Concave 90-degree corner at (2, 2)
    grid.resolveCapsuleStatic(1.85, 0, 1.85, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.equal(res.hitCount, 2);
    assert.ok(Math.abs(res.resolvedX - 1.68) <= 1e-4);
    assert.ok(Math.abs(res.resolvedZ - 1.68) <= 1e-4);
    assert.ok(res.normalX < -0.5 && res.normalZ < -0.5);
    assert.ok(Math.abs(Math.hypot(res.normalX, res.normalY, res.normalZ) - 1) <= 1e-5);

    // Convex corner of standalone pillar at (-4, -4)
    grid.resolveCapsuleStatic(-3.85, 0, -3.85, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.equal(res.hitCount, 1);
    const distFromCorner = Math.hypot(res.resolvedX - -4.0, res.resolvedZ - -4.0);
    assert.ok(Math.abs(distFromCorner - 0.32) <= 1e-4, `expected radial distance 0.32, got ${distFromCorner}`);
    assert.ok(res.normalX > 0.7 && res.normalZ > 0.7);
  });

  it('climbs steppable stairs (<= stepHeight) and blocks tall steps or ceiling-obstructed steps', () => {
    const grid = new SpatialHashGrid();
    grid.insertAABB(1, -10, -1, -10, 10, 0, 10, 1); // base floor y=0
    grid.insertAABB(2, 1.0, 0, -2, 3.0, 0.25, 2, 1); // step 1: 0.25m (<= 0.35m default)
    grid.insertAABB(3, 1.2, 0, -2, 3.0, 0.32, 2, 1); // stacked step 2: 0.32m (<= 0.35m default)
    grid.insertAABB(4, 5.0, 0, -2, 7.0, 0.55, 2, 1); // tall ledge: 0.55m (> 0.35m)
    grid.insertAABB(5, -6.0, 0, -2, -4.0, 0.25, 2, 1); // step under low ceiling
    grid.insertAABB(6, -6.5, 1.9, -2, -3.5, 2.4, 2, 1); // low ceiling at y=1.9 (blocks 0.25 + 1.8 = 2.05)

    const res = createCapsuleCollisionResult();

    // Climb stacked steps up to 0.32m
    grid.resolveCapsuleStatic(0.96, 0, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.equal(res.grounded, true);
    assert.ok(Math.abs(res.resolvedX - 0.96) <= 1e-5, 'expected horizontal progress preserved during stair step-up');
    assert.ok(Math.abs(res.resolvedBaseY - 0.32) <= 1e-4, `expected lift to 0.32, got ${res.resolvedBaseY}`);
    assert.equal(res.normalY, 1);

    // Tall ledge (0.55m > 0.35m) pushes horizontally instead of stepping up
    grid.resolveCapsuleStatic(4.82, 0, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.ok(Math.abs(res.resolvedBaseY - 0) <= 1e-5);
    assert.ok(Math.abs(res.resolvedX - 4.68) <= 1e-4);

    // Step obstructed by low ceiling at y=1.9 refuses step-up and pushes out horizontally
    grid.resolveCapsuleStatic(-3.82, 0, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.ok(Math.abs(res.resolvedBaseY - 0) <= 1e-5);
    assert.ok(Math.abs(res.resolvedX - -3.68) <= 1e-4);
  });

  it('handles floor landing (grounded = true) and upward ceiling stop (grounded = false)', () => {
    const grid = new SpatialHashGrid();
    grid.insertAABB(1, -10, -1, -10, 10, 0, 10, 1); // floor top y=0
    grid.insertAABB(2, -10, 3.0, -10, 10, 3.6, 10, 1); // ceiling bottom y=3.0

    const res = createCapsuleCollisionResult();

    // Penetrating floor due to gravity step (baseY = -0.09)
    grid.resolveCapsuleStatic(0, -0.09, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.equal(res.grounded, true);
    assert.ok(Math.abs(res.resolvedBaseY - 0) <= 1e-5);
    assert.equal(res.normalY, 1);

    // Resting cleanly on floor (baseY = 0)
    grid.resolveCapsuleStatic(0, 0, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, false);
    assert.equal(res.grounded, true);

    // Mid-air freefall (baseY = 0.6 -> top = 2.4 < 3.0)
    grid.resolveCapsuleStatic(0, 0.6, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, false);
    assert.equal(res.grounded, false);

    // Jumping into ceiling (baseY = 1.35, h = 1.8 -> top = 3.15 > 3.0)
    grid.resolveCapsuleStatic(0, 1.35, 0, 0.32, 1.8, 1, res);
    assert.equal(res.collided, true);
    assert.equal(res.grounded, false);
    assert.ok(Math.abs(res.resolvedBaseY - 1.2) <= 1e-4, `expected ceiling clamp to 1.2, got ${res.resolvedBaseY}`);
    assert.equal(res.normalY, -1);
  });
});

describe('SpatialHashGrid — Zero-Allocation & Broadphase Speedup Benchmark', () => {
  it('completes clear + 300 dynamic inserts + 300 sphere queries + 120 DDA raycasts against 750 boxes in < 1.2 ms/frame avg', (t) => {
    const rng = createRng(9001);
    const staticGrid = new SpatialHashGrid({ maxItems: 1024, maxNodes: 16384 });
    const dynamicGrid = new SpatialHashGrid({ maxItems: 512, maxNodes: 4096 });

    // Populate 750 static Hanamura-like colliders
    for (let i = 0; i < 750; i++) {
      const cx = (rng() * 150) - 75;
      const cz = (rng() * 104) - 52;
      const y0 = (rng() * 14) - 2;
      const hw = 0.5 + rng() * 4.5;
      const hd = 0.5 + rng() * 4.5;
      const h = 0.5 + rng() * 5.0;
      staticGrid.insertAABB(i + 1, cx - hw, y0, cz - hd, cx + hw, y0 + h, cz + hd, 0b11);
    }

    // Pre-allocate dynamic actor trajectories & ray tables outside the timed loop
    const dynX = new Float32Array(300);
    const dynY = new Float32Array(300);
    const dynZ = new Float32Array(300);
    const dynVx = new Float32Array(300);
    const dynVz = new Float32Array(300);
    for (let i = 0; i < 300; i++) {
      dynX[i] = (rng() * 140) - 70;
      dynY[i] = rng() * 6;
      dynZ[i] = (rng() * 96) - 48;
      dynVx[i] = (rng() - 0.5) * 0.35;
      dynVz[i] = (rng() - 0.5) * 0.35;
    }

    const rayOx = new Float32Array(120);
    const rayOy = new Float32Array(120);
    const rayOz = new Float32Array(120);
    const rayDx = new Float32Array(120);
    const rayDy = new Float32Array(120);
    const rayDz = new Float32Array(120);
    for (let i = 0; i < 120; i++) {
      rayOx[i] = (rng() * 130) - 65;
      rayOy[i] = 1.2 + rng() * 5.0;
      rayOz[i] = (rng() * 90) - 45;
      const ang = rng() * Math.PI * 2;
      const pitch = (rng() - 0.5) * 0.25;
      const cosP = Math.cos(pitch);
      rayDx[i] = Math.cos(ang) * cosP;
      rayDy[i] = Math.sin(pitch);
      rayDz[i] = Math.sin(ang) * cosP;
    }

    const outIds = new Uint32Array(64);
    const rayHit = createSpatialRayHit();
    let checksum = 0;

    const runFrame = () => {
      dynamicGrid.clear();
      for (let i = 0; i < 300; i++) {
        let nx = dynX[i] + dynVx[i];
        let nz = dynZ[i] + dynVz[i];
        if (nx < -72 || nx > 72) {
          dynVx[i] = -dynVx[i];
          nx = dynX[i] + dynVx[i];
        }
        if (nz < -48 || nz > 48) {
          dynVz[i] = -dynVz[i];
          nz = dynZ[i] + dynVz[i];
        }
        dynX[i] = nx;
        dynZ[i] = nz;
        dynamicGrid.insertSphere(i + 1, nx, dynY[i], nz, 0.45, 1);
      }

      for (let i = 0; i < 300; i++) {
        checksum += dynamicGrid.querySphere(dynX[i], dynY[i], dynZ[i], 2.2, 1, outIds);
      }

      for (let i = 0; i < 120; i++) {
        if (
          staticGrid.raycastAABB(
            rayOx[i],
            rayOy[i],
            rayOz[i],
            rayDx[i],
            rayDy[i],
            rayDz[i],
            80,
            0b11,
            rayHit,
          )
        ) {
          checksum += rayHit.slot;
        }
      }
    };

    // Warm up V8 JIT for 150 frames
    for (let w = 0; w < 150; w++) {
      runFrame();
    }

    const outIdsBufferBefore = outIds.buffer;
    v8.setFlagsFromString('--expose-gc');
    const forceGc = vm.runInNewContext('gc') as () => void;
    forceGc();
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    const MEASURED_FRAMES = 300;
    for (let f = 0; f < MEASURED_FRAMES; f++) {
      runFrame();
    }

    const elapsedMs = performance.now() - t0;
    const avgFrameMs = elapsedMs / MEASURED_FRAMES;
    forceGc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaPerFrame = Math.max(0, heapAfter - heapBefore) / MEASURED_FRAMES;

    t.diagnostic(
      `benchmark 750 static + 300 dynamic + 300 sphere + 120 DDA rays x 300 frames: total=${elapsedMs.toFixed(3)}ms, avg=${avgFrameMs.toFixed(4)}ms/frame, retainedHeapDelta=${heapDeltaPerFrame.toFixed(2)}B/frame`,
    );

    assert.ok(checksum !== -1);
    assert.equal(outIds.buffer, outIdsBufferBefore);
    assert.ok(
      avgFrameMs < 1.2,
      `expected broadphase + DDA benchmark < 1.2 ms/frame, got ${avgFrameMs.toFixed(4)} ms/frame`,
    );
    assert.ok(
      heapDeltaPerFrame < 256,
      `expected zero retained heap growth per frame, got ${heapDeltaPerFrame.toFixed(1)} B/frame`,
    );
  });
});
