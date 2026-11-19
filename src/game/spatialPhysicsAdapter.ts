import * as THREE from 'three';
import {
  SpatialHashGrid,
  createSpatialRayHit,
  type SpatialRayHit,
} from '../engine/spatial/index.ts';
import type {
  ArenaCapsuleMoveResult,
  ArenaNavGrid,
  ArenaPhysics,
  ArenaPhysicsBox,
  ArenaRaycastHit,
} from './engine.ts';

const LAYER_RAY = 1 << 0;
const LAYER_BODY = 1 << 1;

const STEP_HEIGHT = 0.42;
const NAV_CELL = 0.75;
const NAV_MIN_X = -94;
const NAV_MAX_X = 94;
const NAV_MIN_Z = -86;
const NAV_MAX_Z = 86;
const NAV_COLS = Math.round((NAV_MAX_X - NAV_MIN_X) / NAV_CELL);
const NAV_ROWS = Math.round((NAV_MAX_Z - NAV_MIN_Z) / NAV_CELL);
const NAV_PAD = 0.5;

const GRID_COMPACT_THRESHOLD = 3800;
const GRID_MAX_ITEMS = 4096;
const GRID_MAX_NODES = 65536;

export interface PhysicsFrameTelemetry {
  spatialAccelerated: boolean;
  timingEnabled: boolean;
  activeColliders: number;
  gridNodes: number;
  raycastCalls: number;
  losCalls: number;
  groundCalls: number;
  capsuleCalls: number;
  physicsMsAcc: number;
  lastPhysicsMs: number;
  emaPhysicsMs: number;
  resetFrameCounters: () => void;
  setSpatialAccelerated: (enabled: boolean) => void;
  setTimingEnabled: (enabled: boolean) => void;
}

export interface SpatialArenaPhysics extends ArenaPhysics {
  telemetry: PhysicsFrameTelemetry;
}

interface InternalPhysicsBox extends ArenaPhysicsBox {
  __uid: number;
  __slot: number;
  __mask: number;
}

export interface ArenaBoundsSpec {
  min: THREE.Vector3;
  max: THREE.Vector3;
  groundY: number;
  seaY: number;
  quayX: number;
}

function toVec3(v: THREE.Vector3 | readonly number[]): THREE.Vector3 {
  if ((v as THREE.Vector3).isVector3) {
    return (v as THREE.Vector3).clone();
  }
  const arr = v as readonly number[];
  return new THREE.Vector3(arr[0], arr[1], arr[2]);
}

function computeBoxMask(box: ArenaPhysicsBox): number {
  let mask = 0;
  const isAirWall = Boolean(box.tag && box.tag.indexOf('air-wall') === 0);
  if (!box.playerOnly && !box.noBullet && !box.noRay && !isAirWall) {
    mask |= LAYER_RAY;
  }
  if (!box.bulletOnly) {
    mask |= LAYER_BODY;
  }
  return mask;
}

export function createSpatialArenaPhysics(
  rawG: unknown,
  boundsSpec: ArenaBoundsSpec,
): SpatialArenaPhysics {
  const G: Record<string, any> =
    rawG && typeof rawG === 'object' ? (rawG as Record<string, any>) : {};

  const boxes: InternalPhysicsBox[] = [];
  const grid = new SpatialHashGrid({
    minX: -96,
    maxX: 96,
    minZ: -96,
    maxZ: 96,
    cellSize: 4.0,
    maxItems: GRID_MAX_ITEMS,
    maxNodes: GRID_MAX_NODES,
  });

  const slotToBox: (InternalPhysicsBox | null)[] = new Array(GRID_MAX_ITEMS).fill(null);
  let nextUid = 1;
  let navDirty = true;
  let navBlocked = new Uint8Array(NAV_COLS * NAV_ROWS);

  // Pre-allocated zero-GC query buffers & result rings
  const outRay: SpatialRayHit = createSpatialRayHit();
  const losRay: SpatialRayHit = createSpatialRayHit();
  const queryIds = new Uint32Array(1024);
  const querySlots = new Int32Array(1024);
  const losDelta = new THREE.Vector3();

  let hitRingIdx = 0;
  const hitRing: ArenaRaycastHit[] = [];
  for (let i = 0; i < 8; i++) {
    hitRing.push({
      dist: 0,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      surface: 'concrete',
      box: null,
    });
  }

  let capRingIdx = 0;
  const capRing: ArenaCapsuleMoveResult[] = [];
  for (let i = 0; i < 4; i++) {
    capRing.push({
      onGround: false,
      hitWall: false,
      hitCeil: false,
      surface: 'concrete',
    });
  }

  const telemetry: PhysicsFrameTelemetry = {
    spatialAccelerated: true,
    timingEnabled: false,
    activeColliders: 0,
    gridNodes: 0,
    raycastCalls: 0,
    losCalls: 0,
    groundCalls: 0,
    capsuleCalls: 0,
    physicsMsAcc: 0,
    lastPhysicsMs: 0,
    emaPhysicsMs: 0,
    resetFrameCounters() {
      telemetry.lastPhysicsMs = telemetry.physicsMsAcc;
      telemetry.emaPhysicsMs =
        telemetry.emaPhysicsMs === 0
          ? telemetry.physicsMsAcc
          : telemetry.emaPhysicsMs * 0.9 + telemetry.physicsMsAcc * 0.1;
      telemetry.physicsMsAcc = 0;
      telemetry.raycastCalls = 0;
      telemetry.losCalls = 0;
      telemetry.groundCalls = 0;
      telemetry.capsuleCalls = 0;
      telemetry.activeColliders = grid.activeCount;
      telemetry.gridNodes = grid.nodeCount;
    },
    setSpatialAccelerated(enabled: boolean) {
      telemetry.spatialAccelerated = enabled;
    },
    setTimingEnabled(enabled: boolean) {
      telemetry.timingEnabled = enabled;
      if (!enabled) {
        telemetry.physicsMsAcc = 0;
        telemetry.lastPhysicsMs = 0;
        telemetry.emaPhysicsMs = 0;
      }
    },
  };

  function rebuildSpatialGrid(): void {
    grid.clear();
    slotToBox.fill(null);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      b.__mask = computeBoxMask(b);
      if (b.__mask !== 0) {
        const slot = grid.insertAABB(
          b.__uid,
          b.min.x,
          b.min.y,
          b.min.z,
          b.max.x,
          b.max.y,
          b.max.z,
          b.__mask,
        );
        b.__slot = slot;
        if (slot >= 0) {
          slotToBox[slot] = b;
        }
      } else {
        b.__slot = -1;
      }
    }
    telemetry.activeColliders = grid.activeCount;
    telemetry.gridNodes = grid.nodeCount;
  }

  function raycastLegacy(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): ArenaRaycastHit | null {
    let bestT = maxDist;
    let bestBox: InternalPhysicsBox | null = null;
    let bestAxis = -1;
    let bestSign = 0;
    let planeKind = 0;

    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    if (dy < -1e-6) {
      const tg = (boundsSpec.groundY - oy) / dy;
      if (tg > 0 && tg < bestT) {
        if (ox + dx * tg <= boundsSpec.quayX) {
          bestT = tg;
          planeKind = 1;
        } else {
          const ts = (boundsSpec.seaY - oy) / dy;
          if (ts > 0 && ts < bestT) {
            bestT = ts;
            planeKind = 2;
          }
        }
      }
    }

    const invDx = dx === 0 ? Infinity : 1 / dx;
    const invDy = dy === 0 ? Infinity : 1 / dy;
    const invDz = dz === 0 ? Infinity : 1 / dz;

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if ((b.__mask & LAYER_RAY) === 0) continue;

      let tEnter = 0;
      let tExit = bestT;
      let axis = -1;
      let sign = 0;

      if (dx !== 0) {
        let t0 = (b.min.x - ox) * invDx;
        let t1 = (b.max.x - ox) * invDx;
        let s = -1;
        if (t0 > t1) {
          const tmp = t0;
          t0 = t1;
          t1 = tmp;
          s = 1;
        }
        if (t0 > tEnter) {
          tEnter = t0;
          axis = 0;
          sign = s;
        }
        if (t1 < tExit) tExit = t1;
        if (tEnter > tExit) continue;
      } else if (ox < b.min.x || ox > b.max.x) {
        continue;
      }

      if (dy !== 0) {
        let t0 = (b.min.y - oy) * invDy;
        let t1 = (b.max.y - oy) * invDy;
        let s = -1;
        if (t0 > t1) {
          const tmp = t0;
          t0 = t1;
          t1 = tmp;
          s = 1;
        }
        if (t0 > tEnter) {
          tEnter = t0;
          axis = 1;
          sign = s;
        }
        if (t1 < tExit) tExit = t1;
        if (tEnter > tExit) continue;
      } else if (oy < b.min.y || oy > b.max.y) {
        continue;
      }

      if (dz !== 0) {
        let t0 = (b.min.z - oz) * invDz;
        let t1 = (b.max.z - oz) * invDz;
        let s = -1;
        if (t0 > t1) {
          const tmp = t0;
          t0 = t1;
          t1 = tmp;
          s = 1;
        }
        if (t0 > tEnter) {
          tEnter = t0;
          axis = 2;
          sign = s;
        }
        if (t1 < tExit) tExit = t1;
        if (tEnter > tExit) continue;
      } else if (oz < b.min.z || oz > b.max.z) {
        continue;
      }

      if (axis >= 0) {
        bestT = tEnter;
        bestBox = b;
        bestAxis = axis;
        bestSign = sign;
        planeKind = 0;
      }
    }

    if (!bestBox && planeKind === 0) return null;

    const hr = hitRing[(hitRingIdx = (hitRingIdx + 1) & 7)];
    hr.dist = bestT;
    hr.point.set(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
    if (planeKind !== 0) {
      hr.normal.set(0, 1, 0);
      hr.surface =
        planeKind === 2
          ? 'water'
          : G.level && G.level.groundSurfaceAt
            ? G.level.groundSurfaceAt(hr.point.x, hr.point.z)
            : 'concrete';
      hr.box = null;
      return hr;
    }

    hr.normal.set(0, 0, 0);
    hr.normal.setComponent(bestAxis, bestSign);
    hr.surface = bestBox!.surface;
    hr.box = bestBox;
    return hr;
  }

  function raycastSpatial(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): ArenaRaycastHit | null {
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    const dirLenSq = dx * dx + dy * dy + dz * dz;
    if (!(dirLenSq > 0) || !(maxDist >= 0)) return null;
    const dirLen = Math.abs(dirLenSq - 1) <= 1e-10 ? 1 : Math.sqrt(dirLenSq);

    let bestParamT = maxDist;
    let planeKind = 0;

    if (dy < -1e-6) {
      const tg = (boundsSpec.groundY - oy) / dy;
      if (tg > 0 && tg < bestParamT) {
        if (ox + dx * tg <= boundsSpec.quayX) {
          bestParamT = tg;
          planeKind = 1;
        } else {
          const ts = (boundsSpec.seaY - oy) / dy;
          if (ts > 0 && ts < bestParamT) {
            bestParamT = ts;
            planeKind = 2;
          }
        }
      }
    }

    const maxWorldDist = bestParamT * dirLen;
    const hitBox = grid.raycastAABB(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      maxWorldDist,
      LAYER_RAY,
      outRay,
      { ignoreInsideOrigin: true },
    );

    if (hitBox && outRay.distance > 0) {
      const box = slotToBox[outRay.slot];
      const paramT = dirLen === 1 ? outRay.distance : outRay.distance / dirLen;
      if (box && paramT <= bestParamT) {
        const hr = hitRing[(hitRingIdx = (hitRingIdx + 1) & 7)];
        hr.dist = paramT;
        hr.point.set(outRay.pointX, outRay.pointY, outRay.pointZ);
        hr.normal.set(outRay.normalX, outRay.normalY, outRay.normalZ);
        hr.surface = box.surface;
        hr.box = box;
        return hr;
      }
    }

    if (planeKind !== 0) {
      const hr = hitRing[(hitRingIdx = (hitRingIdx + 1) & 7)];
      hr.dist = bestParamT;
      hr.point.set(ox + dx * bestParamT, oy + dy * bestParamT, oz + dz * bestParamT);
      hr.normal.set(0, 1, 0);
      hr.surface =
        planeKind === 2
          ? 'water'
          : G.level && G.level.groundSurfaceAt
            ? G.level.groundSurfaceAt(hr.point.x, hr.point.z)
            : 'concrete';
      hr.box = null;
      return hr;
    }

    return null;
  }

  // --- 2D NavGrid & Octile A* Pathfinding ---
  function ensureNav(): void {
    if (navDirty) buildNav();
  }

  function buildNav(): void {
    navBlocked = new Uint8Array(NAV_COLS * NAV_ROWS);
    navDirty = false;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.noNav || b.bulletOnly || b.max.y < STEP_HEIGHT + 0.05 || b.min.y > 1.5) continue;
      const c0 = Math.max(0, Math.floor((b.min.x - NAV_PAD - NAV_MIN_X) / NAV_CELL));
      const c1 = Math.min(NAV_COLS - 1, Math.floor((b.max.x + NAV_PAD - NAV_MIN_X) / NAV_CELL));
      const r0 = Math.max(0, Math.floor((b.min.z - NAV_PAD - NAV_MIN_Z) / NAV_CELL));
      const r1 = Math.min(NAV_ROWS - 1, Math.floor((b.max.z + NAV_PAD - NAV_MIN_Z) / NAV_CELL));
      for (let r = r0; r <= r1; r++) {
        const rowOff = r * NAV_COLS;
        for (let c = c0; c <= c1; c++) {
          navBlocked[rowOff + c] = 1;
        }
      }
    }
    for (let r = 0; r < NAV_ROWS; r++) {
      const rowOff = r * NAV_COLS;
      for (let c = 0; c < NAV_COLS; c++) {
        if (
          NAV_MIN_X + (c + 0.5) * NAV_CELL > boundsSpec.quayX - NAV_PAD ||
          c === 0 ||
          r === 0 ||
          c === NAV_COLS - 1 ||
          r === NAV_ROWS - 1
        ) {
          navBlocked[rowOff + c] = 1;
        }
      }
    }
  }

  function cellIndexAt(x: number, z: number): number {
    const c = Math.floor((x - NAV_MIN_X) / NAV_CELL);
    const r = Math.floor((z - NAV_MIN_Z) / NAV_CELL);
    return c < 0 || r < 0 || c >= NAV_COLS || r >= NAV_ROWS ? -1 : r * NAV_COLS + c;
  }

  function cellCenterVec(idx: number): THREE.Vector3 {
    return new THREE.Vector3(
      NAV_MIN_X + ((idx % NAV_COLS) + 0.5) * NAV_CELL,
      0,
      NAV_MIN_Z + (Math.floor(idx / NAV_COLS) + 0.5) * NAV_CELL,
    );
  }

  function nearestWalkableCell(x: number, z: number): number {
    let c = Math.max(0, Math.min(NAV_COLS - 1, Math.floor((x - NAV_MIN_X) / NAV_CELL)));
    let r = Math.max(0, Math.min(NAV_ROWS - 1, Math.floor((z - NAV_MIN_Z) / NAV_CELL)));
    if (!navBlocked[r * NAV_COLS + c]) return r * NAV_COLS + c;
    for (let rad = 1; rad <= 12; rad++) {
      let best = -1;
      let bestSq = 1e9;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= NAV_COLS || nr >= NAV_ROWS) continue;
          if (!navBlocked[nr * NAV_COLS + nc]) {
            const dSq = dc * dc + dr * dr;
            if (dSq < bestSq) {
              bestSq = dSq;
              best = nr * NAV_COLS + nc;
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  function hasGridLineOfSight(a: number, b: number): boolean {
    let x0 = a % NAV_COLS;
    let y0 = Math.floor(a / NAV_COLS);
    const x1 = b % NAV_COLS;
    const y1 = Math.floor(b / NAV_COLS);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let step = 0; step < 600; step++) {
      if (navBlocked[y0 * NAV_COLS + x0]) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) {
        if (navBlocked[y0 * NAV_COLS + x0 + sx] || navBlocked[(y0 + sy) * NAV_COLS + x0]) {
          return false;
        }
        err += dx - dy;
        x0 += sx;
        y0 += sy;
      } else if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      } else {
        err += dx;
        y0 += sy;
      }
    }
    return false;
  }

  const gScore = new Float32Array(NAV_COLS * NAV_ROWS);
  const cameFrom = new Int32Array(NAV_COLS * NAV_ROWS);
  const seenStamp = new Uint32Array(NAV_COLS * NAV_ROWS);
  const closedStamp = new Uint32Array(NAV_COLS * NAV_ROWS);
  let astarGen = 0;
  const heapNodes: number[] = [];
  const heapCosts: number[] = [];

  function heapPush(node: number, cost: number): void {
    let idx = heapNodes.length;
    heapNodes.push(node);
    heapCosts.push(cost);
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (heapCosts[parent] <= cost) break;
      heapNodes[idx] = heapNodes[parent];
      heapCosts[idx] = heapCosts[parent];
      idx = parent;
    }
    heapNodes[idx] = node;
    heapCosts[idx] = cost;
  }

  function heapPop(): number {
    const top = heapNodes[0];
    const lastNode = heapNodes.pop()!;
    const lastCost = heapCosts.pop()!;
    const len = heapNodes.length;
    if (len > 0) {
      let idx = 0;
      for (;;) {
        let child = 2 * idx + 1;
        if (child >= len) break;
        if (child + 1 < len && heapCosts[child + 1] < heapCosts[child]) child++;
        if (heapCosts[child] >= lastCost) break;
        heapNodes[idx] = heapNodes[child];
        heapCosts[idx] = heapCosts[child];
        idx = child;
      }
      heapNodes[idx] = lastNode;
      heapCosts[idx] = lastCost;
    }
    return top;
  }

  function runAStar(start: number, goal: number): number[] | null {
    astarGen++;
    heapNodes.length = 0;
    heapCosts.length = 0;
    const gx = goal % NAV_COLS;
    const gy = Math.floor(goal / NAV_COLS);
    const heuristic = (n: number): number => {
      const dx = Math.abs((n % NAV_COLS) - gx);
      const dy = Math.abs(Math.floor(n / NAV_COLS) - gy);
      return dx + dy + (1.4142 - 2) * Math.min(dx, dy);
    };
    gScore[start] = 0;
    seenStamp[start] = astarGen;
    cameFrom[start] = -1;
    heapPush(start, heuristic(start));

    let visited = 0;
    while (heapNodes.length > 0) {
      const curr = heapPop();
      if (curr === goal) break;
      if (closedStamp[curr] === astarGen) continue;
      closedStamp[curr] = astarGen;
      if (++visited > 9000) return null;

      const cx = curr % NAV_COLS;
      const cy = Math.floor(curr / NAV_COLS);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= NAV_COLS || ny >= NAV_ROWS) continue;
          const next = ny * NAV_COLS + nx;
          if (
            navBlocked[next] ||
            closedStamp[next] === astarGen ||
            (dx !== 0 && dy !== 0 && (navBlocked[cy * NAV_COLS + nx] || navBlocked[ny * NAV_COLS + cx]))
          ) {
            continue;
          }
          const tentativeG = gScore[curr] + (dx !== 0 && dy !== 0 ? 1.4142 : 1);
          if (seenStamp[next] !== astarGen || tentativeG < gScore[next]) {
            gScore[next] = tentativeG;
            seenStamp[next] = astarGen;
            cameFrom[next] = curr;
            heapPush(next, tentativeG + heuristic(next));
          }
        }
      }
    }

    if (seenStamp[goal] !== astarGen) return null;
    const path: number[] = [];
    for (let curr = goal; curr !== -1; curr = cameFrom[curr]) {
      path.push(curr);
    }
    path.reverse();
    return path;
  }

  const nav: ArenaNavGrid = {
    cell: NAV_CELL,
    isWalkable(x: number, z: number): boolean {
      ensureNav();
      const idx = cellIndexAt(x, z);
      return idx >= 0 && !navBlocked[idx];
    },
    findPath(from: { x: number; z: number }, to: { x: number; z: number }): THREE.Vector3[] | null {
      ensureNav();
      const start = nearestWalkableCell(from.x, from.z);
      const goal = nearestWalkableCell(to.x, to.z);
      if (start < 0 || goal < 0) return null;
      if (start === goal) return [new THREE.Vector3(to.x, 0, to.z)];
      const raw = runAStar(start, goal);
      if (!raw) return null;
      const pulled: THREE.Vector3[] = [];
      let idx = 0;
      while (idx < raw.length - 1) {
        let next = idx + 1;
        for (let probe = raw.length - 1; probe > idx + 1; probe--) {
          if (hasGridLineOfSight(raw[idx], raw[probe])) {
            next = probe;
            break;
          }
        }
        pulled.push(cellCenterVec(raw[next]));
        idx = next;
      }
      if (cellIndexAt(to.x, to.z) === goal && pulled.length > 0) {
        pulled[pulled.length - 1].set(to.x, 0, to.z);
      }
      return pulled;
    },
    randomPoint(center: { x: number; z: number }, radius: number): THREE.Vector3 {
      ensureNav();
      for (let attempt = 0; attempt < 24; attempt++) {
        const ang = Math.random() * 6.2832;
        const r = Math.sqrt(Math.random()) * radius;
        const px = center.x + Math.cos(ang) * r;
        const pz = center.z + Math.sin(ang) * r;
        const idx = cellIndexAt(px, pz);
        if (idx >= 0 && !navBlocked[idx]) {
          return new THREE.Vector3(px, 0, pz);
        }
      }
      const fallback = nearestWalkableCell(center.x, center.z);
      return fallback >= 0 ? cellCenterVec(fallback) : new THREE.Vector3(center.x, 0, center.z);
    },
    clearLine(from: { x: number; z: number }, to: { x: number; z: number }): boolean {
      ensureNav();
      const a = cellIndexAt(from.x, from.z);
      const b = cellIndexAt(to.x, to.z);
      return a >= 0 && b >= 0 && hasGridLineOfSight(a, b);
    },
    _grid() {
      ensureNav();
      return {
        blocked: navBlocked,
        w: NAV_COLS,
        h: NAV_ROWS,
        minX: NAV_MIN_X,
        minZ: NAV_MIN_Z,
        cell: NAV_CELL,
      };
    },
  };

  const api: SpatialArenaPhysics = {
    boxes,
    bounds: {
      min: boundsSpec.min.clone(),
      max: boundsSpec.max.clone(),
    },
    telemetry,
    addBox(minInput, maxInput, opts = {}) {
      const a = toVec3(minInput);
      const b = toVec3(maxInput);
      const box: InternalPhysicsBox = {
        min: new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
        max: new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)),
        surface: opts.surface || 'concrete',
        tag: opts.tag || '',
        noNav: Boolean(opts.noNav),
        bulletOnly: Boolean(opts.bulletOnly),
        playerOnly: Boolean(opts.playerOnly),
        noBullet: Boolean(opts.noBullet),
        noRay: Boolean(opts.noRay),
        __uid: nextUid++,
        __slot: -1,
        __mask: 0,
      };
      box.__mask = computeBoxMask(box);
      boxes.push(box);
      navDirty = true;

      if (grid.itemCount >= GRID_COMPACT_THRESHOLD) {
        rebuildSpatialGrid();
      } else if (box.__mask !== 0) {
        const slot = grid.insertAABB(
          box.__uid,
          box.min.x,
          box.min.y,
          box.min.z,
          box.max.x,
          box.max.y,
          box.max.z,
          box.__mask,
        );
        if (slot >= 0) {
          box.__slot = slot;
          slotToBox[slot] = box;
        } else {
          rebuildSpatialGrid();
        }
      }
      telemetry.activeColliders = grid.activeCount;
      telemetry.gridNodes = grid.nodeCount;
      return box;
    },
    removeBox(target: ArenaPhysicsBox) {
      const internal = target as InternalPhysicsBox;
      if (internal && internal.__slot >= 0) {
        grid.disableSlot(internal.__slot);
        slotToBox[internal.__slot] = null;
        internal.__slot = -1;
      }
      const idx = boxes.indexOf(internal);
      if (idx >= 0) {
        boxes.splice(idx, 1);
        navDirty = true;
      }
      telemetry.activeColliders = grid.activeCount;
      telemetry.gridNodes = grid.nodeCount;
    },
    build() {
      rebuildSpatialGrid();
      buildNav();
    },
    raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 500): ArenaRaycastHit | null {
      telemetry.raycastCalls++;
      if (!telemetry.timingEnabled) {
        return telemetry.spatialAccelerated
          ? raycastSpatial(origin, dir, maxDist)
          : raycastLegacy(origin, dir, maxDist);
      }
      const t0 = performance.now();
      const res = telemetry.spatialAccelerated
        ? raycastSpatial(origin, dir, maxDist)
        : raycastLegacy(origin, dir, maxDist);
      telemetry.physicsMsAcc += performance.now() - t0;
      return res;
    },
    lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
      telemetry.losCalls++;
      const t0 = telemetry.timingEnabled ? performance.now() : 0;

      losDelta.subVectors(to, from);
      const dist = losDelta.length();
      if (dist < 1e-4) return true;
      const maxRay = dist - 0.05;
      if (maxRay <= 0) return true;

      losDelta.multiplyScalar(1 / dist);
      let clear: boolean;
      if (telemetry.spatialAccelerated) {
        // Check analytical ground/sea plane first
        let planeBlocked = false;
        if (losDelta.y < -1e-6) {
          const tg = (boundsSpec.groundY - from.y) / losDelta.y;
          if (tg > 0 && tg < maxRay) {
            if (from.x + losDelta.x * tg <= boundsSpec.quayX) {
              planeBlocked = true;
            } else {
              const ts = (boundsSpec.seaY - from.y) / losDelta.y;
              if (ts > 0 && ts < maxRay) planeBlocked = true;
            }
          }
        }
        clear =
          !planeBlocked &&
          !(
            grid.raycastAABB(
              from.x,
              from.y,
              from.z,
              losDelta.x,
              losDelta.y,
              losDelta.z,
              maxRay,
              LAYER_RAY,
              losRay,
              { ignoreInsideOrigin: true },
            ) && losRay.distance > 0
          );
      } else {
        clear = !raycastLegacy(from, losDelta, maxRay);
      }

      if (telemetry.timingEnabled) {
        telemetry.physicsMsAcc += performance.now() - t0;
      }
      return clear;
    },
    groundHeight(x: number, z: number, maxY = 50): number {
      telemetry.groundCalls++;
      const t0 = telemetry.timingEnabled ? performance.now() : 0;

      let bestY = x <= boundsSpec.quayX ? boundsSpec.groundY : boundsSpec.seaY;
      if (telemetry.spatialAccelerated) {
        const count = grid.queryAABB(
          x - 1e-4,
          bestY - 1e-4,
          z - 1e-4,
          x + 1e-4,
          maxY + 1e-4,
          z + 1e-4,
          LAYER_BODY,
          queryIds,
          querySlots,
        );
        for (let i = 0; i < count; i++) {
          const b = slotToBox[querySlots[i]];
          if (
            b &&
            x >= b.min.x &&
            x <= b.max.x &&
            z >= b.min.z &&
            z <= b.max.z &&
            b.max.y <= maxY &&
            b.max.y > bestY
          ) {
            bestY = b.max.y;
          }
        }
      } else {
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (
            !b.bulletOnly &&
            x >= b.min.x &&
            x <= b.max.x &&
            z >= b.min.z &&
            z <= b.max.z &&
            b.max.y <= maxY &&
            b.max.y > bestY
          ) {
            bestY = b.max.y;
          }
        }
      }

      if (telemetry.timingEnabled) {
        telemetry.physicsMsAcc += performance.now() - t0;
      }
      return bestY;
    },
    moveCapsule(
      pos: THREE.Vector3,
      vel: THREE.Vector3,
      dt: number,
      radius = 0.32,
      height = 1.8,
      grounded = true,
    ): ArenaCapsuleMoveResult {
      telemetry.capsuleCalls++;
      const t0 = telemetry.timingEnabled ? performance.now() : 0;

      const out = capRing[(capRingIdx = (capRingIdx + 1) & 3)];
      out.onGround = false;
      out.hitWall = false;
      out.hitCeil = false;
      out.surface = 'concrete';

      const dxTotal = vel.x * dt;
      const dzTotal = vel.z * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(dxTotal, dzTotal) / (radius * 0.6)));
      const startY = pos.y;
      const stepAllowance = grounded ? STEP_HEIGHT : 0.08;

      if (telemetry.spatialAccelerated) {
        const nextYEst = pos.y + vel.y * dt;
        const halfWindowXZ = Math.max(Math.abs(dxTotal), Math.abs(dzTotal)) + radius * 2 + 0.6;
        const sweepMinY = Math.min(startY, nextYEst) - STEP_HEIGHT - 1.0;
        const sweepMaxY = Math.max(startY, nextYEst) + height + 1.0;

        let winCenterX = 0;
        let winCenterZ = 0;
        let candCount = 0;

        const refreshCandidates = (cx: number, cz: number): void => {
          winCenterX = cx;
          winCenterZ = cz;
          candCount = grid.queryAABB(
            cx - halfWindowXZ,
            sweepMinY,
            cz - halfWindowXZ,
            cx + halfWindowXZ,
            sweepMaxY,
            cz + halfWindowXZ,
            LAYER_BODY,
            queryIds,
            querySlots,
          );
          for (let i = 1; i < candCount; i++) {
            const key = querySlots[i];
            let j = i - 1;
            while (j >= 0 && querySlots[j] > key) {
              querySlots[j + 1] = querySlots[j];
              j--;
            }
            querySlots[j + 1] = key;
          }
        };

        refreshCandidates(pos.x + dxTotal * 0.5, pos.z + dzTotal * 0.5);
        const safeMargin = halfWindowXZ - radius - 1e-3;

        for (let step = 0; step < steps; step++) {
          pos.x += dxTotal / steps;
          pos.z += dzTotal / steps;
          for (let iter = 0; iter < 3; iter++) {
            if (
              Math.abs(pos.x - winCenterX) > safeMargin ||
              Math.abs(pos.z - winCenterZ) > safeMargin
            ) {
              refreshCandidates(pos.x, pos.z);
            }
            let pushed = false;
            for (let k = 0; k < candCount; k++) {
              const b = slotToBox[querySlots[k]];
              if (!b || b.max.y <= pos.y + stepAllowance || b.min.y >= pos.y + height) continue;
              const qx = Math.max(b.min.x, Math.min(b.max.x, pos.x));
              const qz = Math.max(b.min.z, Math.min(b.max.z, pos.z));
              let ox = pos.x - qx;
              let oz = pos.z - qz;
              const distSq = ox * ox + oz * oz;
              if (distSq < radius * radius) {
                if (distSq > 1e-10) {
                  const dist = Math.sqrt(distSq);
                  const pen = radius - dist;
                  ox /= dist;
                  oz /= dist;
                  pos.x += ox * pen;
                  pos.z += oz * pen;
                  const vn = vel.x * ox + vel.z * oz;
                  if (vn < 0) {
                    vel.x -= ox * vn;
                    vel.z -= oz * vn;
                  }
                } else {
                  const dl = pos.x - b.min.x;
                  const dr = b.max.x - pos.x;
                  const db = pos.z - b.min.z;
                  const df = b.max.z - pos.z;
                  const m = Math.min(dl, dr, db, df);
                  if (m === dl) {
                    pos.x = b.min.x - radius;
                    if (vel.x > 0) vel.x = 0;
                  } else if (m === dr) {
                    pos.x = b.max.x + radius;
                    if (vel.x < 0) vel.x = 0;
                  } else if (m === db) {
                    pos.z = b.min.z - radius;
                    if (vel.z > 0) vel.z = 0;
                  } else {
                    pos.z = b.max.z + radius;
                    if (vel.z < 0) vel.z = 0;
                  }
                }
                pushed = true;
                out.hitWall = true;
                if (
                  Math.abs(pos.x - winCenterX) > safeMargin ||
                  Math.abs(pos.z - winCenterZ) > safeMargin
                ) {
                  const prevSlot = querySlots[k];
                  refreshCandidates(pos.x, pos.z);
                  let nextK = 0;
                  while (nextK < candCount && querySlots[nextK] <= prevSlot) {
                    nextK++;
                  }
                  k = nextK - 1;
                }
              }
            }
            if (!pushed) break;
          }
        }

        if (
          Math.abs(pos.x - winCenterX) > safeMargin ||
          Math.abs(pos.z - winCenterZ) > safeMargin
        ) {
          refreshCandidates(pos.x, pos.z);
        }

        const nextY = pos.y + vel.y * dt;
        const footR = radius * 0.7;
        let floorY = pos.x <= boundsSpec.quayX + footR ? boundsSpec.groundY : -50;
        let floorSurface: string | null = null;
        let ceilY = Infinity;
        const maxFloorClimbY = startY + stepAllowance + 1e-4;

        for (let k = 0; k < candCount; k++) {
          const b = slotToBox[querySlots[k]];
          if (
            !b ||
            pos.x + footR < b.min.x ||
            pos.x - footR > b.max.x ||
            pos.z + footR < b.min.z ||
            pos.z - footR > b.max.z
          ) {
            continue;
          }
          if (b.max.y <= maxFloorClimbY && b.max.y > floorY) {
            floorY = b.max.y;
            floorSurface = b.surface;
          }
          if (b.min.y >= startY + height - 0.05 && b.min.y < ceilY) {
            ceilY = b.min.y;
          }
        }

        if (vel.y > 0 && nextY + height > ceilY) {
          pos.y = ceilY - height;
          vel.y = 0;
          out.hitCeil = true;
        } else if (nextY <= floorY) {
          pos.y = floorY;
          if (vel.y < 0) vel.y = 0;
          out.onGround = true;
        } else if (grounded && vel.y <= 0 && nextY - floorY < STEP_HEIGHT) {
          pos.y = floorY;
          vel.y = 0;
          out.onGround = true;
        } else {
          pos.y = nextY;
        }

        if (out.onGround) {
          out.surface =
            floorSurface ||
            (G.level && G.level.groundSurfaceAt ? G.level.groundSurfaceAt(pos.x, pos.z) : 'concrete');
        }
      } else {
        // Legacy O(N) full-array scan path for A/B comparison
        for (let step = 0; step < steps; step++) {
          pos.x += dxTotal / steps;
          pos.z += dzTotal / steps;
          for (let iter = 0; iter < 3; iter++) {
            let pushed = false;
            for (let i = 0; i < boxes.length; i++) {
              const b = boxes[i];
              if (b.bulletOnly || b.max.y <= pos.y + stepAllowance || b.min.y >= pos.y + height) {
                continue;
              }
              const qx = Math.max(b.min.x, Math.min(b.max.x, pos.x));
              const qz = Math.max(b.min.z, Math.min(b.max.z, pos.z));
              let ox = pos.x - qx;
              let oz = pos.z - qz;
              const distSq = ox * ox + oz * oz;
              if (distSq < radius * radius) {
                if (distSq > 1e-10) {
                  const dist = Math.sqrt(distSq);
                  const pen = radius - dist;
                  ox /= dist;
                  oz /= dist;
                  pos.x += ox * pen;
                  pos.z += oz * pen;
                  const vn = vel.x * ox + vel.z * oz;
                  if (vn < 0) {
                    vel.x -= ox * vn;
                    vel.z -= oz * vn;
                  }
                } else {
                  const dl = pos.x - b.min.x;
                  const dr = b.max.x - pos.x;
                  const db = pos.z - b.min.z;
                  const df = b.max.z - pos.z;
                  const m = Math.min(dl, dr, db, df);
                  if (m === dl) {
                    pos.x = b.min.x - radius;
                    if (vel.x > 0) vel.x = 0;
                  } else if (m === dr) {
                    pos.x = b.max.x + radius;
                    if (vel.x < 0) vel.x = 0;
                  } else if (m === db) {
                    pos.z = b.min.z - radius;
                    if (vel.z > 0) vel.z = 0;
                  } else {
                    pos.z = b.max.z + radius;
                    if (vel.z < 0) vel.z = 0;
                  }
                }
                pushed = true;
                out.hitWall = true;
              }
            }
            if (!pushed) break;
          }
        }

        const nextY = pos.y + vel.y * dt;
        const footR = radius * 0.7;
        let floorY = pos.x <= boundsSpec.quayX + footR ? boundsSpec.groundY : -50;
        let floorSurface: string | null = null;
        let ceilY = Infinity;
        const maxFloorClimbY = startY + stepAllowance + 1e-4;

        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (
            b.bulletOnly ||
            pos.x + footR < b.min.x ||
            pos.x - footR > b.max.x ||
            pos.z + footR < b.min.z ||
            pos.z - footR > b.max.z
          ) {
            continue;
          }
          if (b.max.y <= maxFloorClimbY && b.max.y > floorY) {
            floorY = b.max.y;
            floorSurface = b.surface;
          }
          if (b.min.y >= startY + height - 0.05 && b.min.y < ceilY) {
            ceilY = b.min.y;
          }
        }

        if (vel.y > 0 && nextY + height > ceilY) {
          pos.y = ceilY - height;
          vel.y = 0;
          out.hitCeil = true;
        } else if (nextY <= floorY) {
          pos.y = floorY;
          if (vel.y < 0) vel.y = 0;
          out.onGround = true;
        } else if (grounded && vel.y <= 0 && nextY - floorY < STEP_HEIGHT) {
          pos.y = floorY;
          vel.y = 0;
          out.onGround = true;
        } else {
          pos.y = nextY;
        }

        if (out.onGround) {
          out.surface =
            floorSurface ||
            (G.level && G.level.groundSurfaceAt ? G.level.groundSurfaceAt(pos.x, pos.z) : 'concrete');
        }
      }

      if (telemetry.timingEnabled) {
        telemetry.physicsMsAcc += performance.now() - t0;
      }
      return out;
    },
    nav,
  };

  return api;
}
