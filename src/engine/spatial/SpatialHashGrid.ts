export interface SpatialGridConfig {
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  cellSize?: number;
  maxItems?: number;
  maxNodes?: number;
}

export interface SpatialRayHit {
  hit: boolean;
  id: number;
  slot: number;
  distance: number;
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface GroundSampleHit {
  found: boolean;
  groundY: number;
  id: number;
  slot: number;
}

export interface CapsuleCollisionResult {
  collided: boolean;
  grounded: boolean;
  resolvedX: number;
  resolvedBaseY: number;
  resolvedZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  hitCount: number;
}

export interface RaycastOptions {
  ignoreInsideOrigin?: boolean;
  ignoreId?: number;
}

export const DEFAULT_SPATIAL_MIN_X = -96;
export const DEFAULT_SPATIAL_MAX_X = 96;
export const DEFAULT_SPATIAL_MIN_Z = -96;
export const DEFAULT_SPATIAL_MAX_Z = 96;
export const DEFAULT_SPATIAL_CELL_SIZE = 4.0;
export const DEFAULT_SPATIAL_MAX_ITEMS = 2048;
export const DEFAULT_SPATIAL_MAX_NODES = 16384;
export const ALL_SPATIAL_LAYERS = 0xffffffff;

const DEFAULT_STEP_HEIGHT = 0.35;
const SOLVER_MAX_ITERATIONS = 4;
const PENETRATION_EPS = 1e-6;
const GROUND_CONTACT_EPS = 1e-3;
const FOOTPRINT_SKIN_EPS = 1e-4;
const RAY_DIR_EPS = 1e-15;
const DDA_CORNER_EPS = 1e-6;
const MAX_GRID_CELLS = 16_777_216;
const STAMP_WRAP_THRESHOLD = 0xffffffff;

export function createSpatialRayHit(): SpatialRayHit {
  return {
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
  };
}

export function createGroundSampleHit(): GroundSampleHit {
  return {
    found: false,
    groundY: 0,
    id: 0,
    slot: -1,
  };
}

export function createCapsuleCollisionResult(): CapsuleCollisionResult {
  return {
    collided: false,
    grounded: false,
    resolvedX: 0,
    resolvedBaseY: 0,
    resolvedZ: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    hitCount: 0,
  };
}

export class SpatialHashGrid {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly maxItems: number;
  readonly maxNodes: number;

  private readonly cellHeads: Int32Array;
  private readonly nodeItem: Int32Array;
  private readonly nodeNext: Int32Array;

  private readonly itemId: Int32Array;
  private readonly itemIdWide: Float64Array;
  private readonly itemMinX: Float32Array;
  private readonly itemMinY: Float32Array;
  private readonly itemMinZ: Float32Array;
  private readonly itemMaxX: Float32Array;
  private readonly itemMaxY: Float32Array;
  private readonly itemMaxZ: Float32Array;
  private readonly layerMask: Uint32Array;
  private readonly itemActive: Uint8Array;
  private readonly itemStamp: Uint32Array;

  private readonly slotCx0: Int32Array;
  private readonly slotCx1: Int32Array;
  private readonly slotCz0: Int32Array;
  private readonly slotCz1: Int32Array;

  private readonly outOfBoundsSlots: Int32Array;
  private readonly slotOobIndex: Int32Array;
  private outOfBoundsCount = 0;

  private readonly scratchSlots: Int32Array;
  private readonly scratchHitSlots: Int32Array;

  private _itemCount = 0;
  private _activeCount = 0;
  private _nodeCount = 0;
  private _overflowCount = 0;
  private nodePoolTop = 0;
  private freeNodeHead = -1;
  private queryStamp = 0;
  private hasWideId = false;

  constructor(config?: SpatialGridConfig) {
    const minX = config?.minX ?? DEFAULT_SPATIAL_MIN_X;
    const maxX = config?.maxX ?? DEFAULT_SPATIAL_MAX_X;
    const minZ = config?.minZ ?? DEFAULT_SPATIAL_MIN_Z;
    const maxZ = config?.maxZ ?? DEFAULT_SPATIAL_MAX_Z;
    const cellSize = config?.cellSize ?? DEFAULT_SPATIAL_CELL_SIZE;
    const maxItems = config?.maxItems ?? DEFAULT_SPATIAL_MAX_ITEMS;
    const maxNodes = config?.maxNodes ?? DEFAULT_SPATIAL_MAX_NODES;

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !(maxX > minX)) {
      throw new RangeError(`Invalid SpatialHashGrid X bounds: [${minX}, ${maxX}]`);
    }
    if (!Number.isFinite(minZ) || !Number.isFinite(maxZ) || !(maxZ > minZ)) {
      throw new RangeError(`Invalid SpatialHashGrid Z bounds: [${minZ}, ${maxZ}]`);
    }
    if (!Number.isFinite(cellSize) || !(cellSize > 0)) {
      throw new RangeError(`Invalid SpatialHashGrid cellSize: ${cellSize}`);
    }
    if (!Number.isFinite(maxItems) || !Number.isInteger(maxItems) || maxItems <= 0) {
      throw new RangeError(`Invalid SpatialHashGrid maxItems: ${maxItems}`);
    }
    if (!Number.isFinite(maxNodes) || !Number.isInteger(maxNodes) || maxNodes <= 0) {
      throw new RangeError(`Invalid SpatialHashGrid maxNodes: ${maxNodes}`);
    }

    const cols = Math.ceil((maxX - minX) / cellSize);
    const rows = Math.ceil((maxZ - minZ) / cellSize);
    const totalCells = cols * rows;
    if (
      !Number.isSafeInteger(cols) ||
      !Number.isSafeInteger(rows) ||
      cols <= 0 ||
      rows <= 0 ||
      !Number.isSafeInteger(totalCells) ||
      totalCells > MAX_GRID_CELLS
    ) {
      throw new RangeError(`Invalid SpatialHashGrid dimensions: ${cols}x${rows}`);
    }

    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.cellSize = cellSize;
    this.cols = cols;
    this.rows = rows;
    this.maxItems = maxItems;
    this.maxNodes = maxNodes;

    this.cellHeads = new Int32Array(totalCells).fill(-1);
    this.nodeItem = new Int32Array(maxNodes);
    this.nodeNext = new Int32Array(maxNodes);

    this.itemId = new Int32Array(maxItems);
    this.itemIdWide = new Float64Array(maxItems);
    this.itemMinX = new Float32Array(maxItems);
    this.itemMinY = new Float32Array(maxItems);
    this.itemMinZ = new Float32Array(maxItems);
    this.itemMaxX = new Float32Array(maxItems);
    this.itemMaxY = new Float32Array(maxItems);
    this.itemMaxZ = new Float32Array(maxItems);
    this.layerMask = new Uint32Array(maxItems);
    this.itemActive = new Uint8Array(maxItems);
    this.itemStamp = new Uint32Array(maxItems);

    this.slotCx0 = new Int32Array(maxItems).fill(-1);
    this.slotCx1 = new Int32Array(maxItems).fill(-1);
    this.slotCz0 = new Int32Array(maxItems).fill(-1);
    this.slotCz1 = new Int32Array(maxItems).fill(-1);

    this.outOfBoundsSlots = new Int32Array(maxItems);
    this.slotOobIndex = new Int32Array(maxItems).fill(-1);

    this.scratchSlots = new Int32Array(maxItems);
    this.scratchHitSlots = new Int32Array(maxItems);
  }

  get itemCount(): number {
    return this._itemCount;
  }

  get activeCount(): number {
    return this._activeCount;
  }

  get nodeCount(): number {
    return this._nodeCount;
  }

  get overflowCount(): number {
    return this._overflowCount;
  }

  clear(): void {
    this.cellHeads.fill(-1);
    this._itemCount = 0;
    this._activeCount = 0;
    this._nodeCount = 0;
    this._overflowCount = 0;
    this.nodePoolTop = 0;
    this.freeNodeHead = -1;
    this.outOfBoundsCount = 0;
    this.hasWideId = false;
  }

  insertAABB(
    id: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    mask = ALL_SPATIAL_LAYERS,
  ): number {
    if (
      !Number.isFinite(id) ||
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      !Number.isFinite(maxZ)
    ) {
      throw new RangeError('insertAABB requires finite numeric id and bounds');
    }

    if (this._itemCount >= this.maxItems) {
      this._overflowCount++;
      return -1;
    }

    const bx0 = Math.fround(minX <= maxX ? minX : maxX);
    const bx1 = Math.fround(minX <= maxX ? maxX : minX);
    const by0 = Math.fround(minY <= maxY ? minY : maxY);
    const by1 = Math.fround(minY <= maxY ? maxY : minY);
    const bz0 = Math.fround(minZ <= maxZ ? minZ : maxZ);
    const bz1 = Math.fround(minZ <= maxZ ? maxZ : minZ);

    let cx0 = -1;
    let cx1 = -1;
    let cz0 = -1;
    let cz1 = -1;
    let neededNodes = 0;

    if (bx1 >= this.minX && bx0 <= this.maxX && bz1 >= this.minZ && bz0 <= this.maxZ) {
      cx0 = this.clampCellX(bx0);
      cx1 = this.clampCellX(bx1);
      cz0 = this.clampCellZ(bz0);
      cz1 = this.clampCellZ(bz1);
      neededNodes = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
    }

    if (this._nodeCount + neededNodes > this.maxNodes) {
      this._overflowCount++;
      return -1;
    }

    const slot = this._itemCount++;
    this._activeCount++;

    const idI32 = id | 0;
    this.itemId[slot] = idI32;
    this.itemIdWide[slot] = id;
    if (idI32 !== id) {
      this.hasWideId = true;
    }
    this.itemMinX[slot] = bx0;
    this.itemMinY[slot] = by0;
    this.itemMinZ[slot] = bz0;
    this.itemMaxX[slot] = bx1;
    this.itemMaxY[slot] = by1;
    this.itemMaxZ[slot] = bz1;
    this.layerMask[slot] = mask >>> 0;
    this.itemActive[slot] = 1;
    this.itemStamp[slot] = 0;

    this.slotCx0[slot] = cx0;
    this.slotCx1[slot] = cx1;
    this.slotCz0[slot] = cz0;
    this.slotCz1[slot] = cz1;
    this.slotOobIndex[slot] = -1;

    if (bx0 < this.minX || bx1 > this.maxX || bz0 < this.minZ || bz1 > this.maxZ) {
      this.addOutOfBoundsSlot(slot);
    }

    if (neededNodes > 0) {
      this.linkSlotToCells(slot, cx0, cx1, cz0, cz1);
    }

    return slot;
  }

  insertSphere(
    id: number,
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    mask = ALL_SPATIAL_LAYERS,
  ): number {
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz) || !Number.isFinite(radius)) {
      throw new RangeError('insertSphere requires finite center and radius');
    }
    const r = radius > 0 ? radius : 0;
    return this.insertAABB(id, cx - r, cy - r, cz - r, cx + r, cy + r, cz + r, mask);
  }

  insertCapsule(
    id: number,
    x: number,
    baseY: number,
    z: number,
    radius: number,
    height: number,
    mask = ALL_SPATIAL_LAYERS,
  ): number {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(baseY) ||
      !Number.isFinite(z) ||
      !Number.isFinite(radius) ||
      !Number.isFinite(height)
    ) {
      throw new RangeError('insertCapsule requires finite coordinates, radius, and height');
    }
    const r = radius > 0 ? radius : 0;
    const h = height > 0 ? height : 0;
    const topY = baseY + Math.max(2 * r, h);
    return this.insertAABB(id, x - r, baseY, z - r, x + r, topY, z + r, mask);
  }

  updateAABB(
    slot: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this._itemCount || this.itemActive[slot] === 0) {
      return false;
    }
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      !Number.isFinite(maxZ)
    ) {
      throw new RangeError('updateAABB requires finite bounds');
    }

    const bx0 = Math.fround(minX <= maxX ? minX : maxX);
    const bx1 = Math.fround(minX <= maxX ? maxX : minX);
    const by0 = Math.fround(minY <= maxY ? minY : maxY);
    const by1 = Math.fround(minY <= maxY ? maxY : minY);
    const bz0 = Math.fround(minZ <= maxZ ? minZ : maxZ);
    const bz1 = Math.fround(minZ <= maxZ ? maxZ : minZ);

    let newCx0 = -1;
    let newCx1 = -1;
    let newCz0 = -1;
    let newCz1 = -1;
    let newNodes = 0;

    if (bx1 >= this.minX && bx0 <= this.maxX && bz1 >= this.minZ && bz0 <= this.maxZ) {
      newCx0 = this.clampCellX(bx0);
      newCx1 = this.clampCellX(bx1);
      newCz0 = this.clampCellZ(bz0);
      newCz1 = this.clampCellZ(bz1);
      newNodes = (newCx1 - newCx0 + 1) * (newCz1 - newCz0 + 1);
    }

    const oldCx0 = this.slotCx0[slot];
    const oldCx1 = this.slotCx1[slot];
    const oldCz0 = this.slotCz0[slot];
    const oldCz1 = this.slotCz1[slot];
    const oldNodes = oldCx0 >= 0 ? (oldCx1 - oldCx0 + 1) * (oldCz1 - oldCz0 + 1) : 0;

    const newOob = bx0 < this.minX || bx1 > this.maxX || bz0 < this.minZ || bz1 > this.maxZ;
    const oldOob = this.slotOobIndex[slot] !== -1;

    if (
      newCx0 === oldCx0 &&
      newCx1 === oldCx1 &&
      newCz0 === oldCz0 &&
      newCz1 === oldCz1 &&
      newOob === oldOob
    ) {
      this.itemMinX[slot] = bx0;
      this.itemMinY[slot] = by0;
      this.itemMinZ[slot] = bz0;
      this.itemMaxX[slot] = bx1;
      this.itemMaxY[slot] = by1;
      this.itemMaxZ[slot] = bz1;
      return true;
    }

    if (this._nodeCount - oldNodes + newNodes > this.maxNodes) {
      this._overflowCount++;
      return false;
    }

    if (oldCx0 >= 0) {
      this.unlinkSlotFromCells(slot, oldCx0, oldCx1, oldCz0, oldCz1);
    }

    if (oldOob && !newOob) {
      this.removeOutOfBoundsSlot(slot);
    } else if (!oldOob && newOob) {
      this.addOutOfBoundsSlot(slot);
    }

    this.itemMinX[slot] = bx0;
    this.itemMinY[slot] = by0;
    this.itemMinZ[slot] = bz0;
    this.itemMaxX[slot] = bx1;
    this.itemMaxY[slot] = by1;
    this.itemMaxZ[slot] = bz1;

    this.slotCx0[slot] = newCx0;
    this.slotCx1[slot] = newCx1;
    this.slotCz0[slot] = newCz0;
    this.slotCz1[slot] = newCz1;

    if (newNodes > 0) {
      this.linkSlotToCells(slot, newCx0, newCx1, newCz0, newCz1);
    }

    return true;
  }

  disableSlot(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this._itemCount) {
      return false;
    }
    if (this.itemActive[slot] === 0) {
      return false;
    }
    this.itemActive[slot] = 0;
    this._activeCount--;
    return true;
  }

  disableById(id: number): number {
    let disabled = 0;
    const count = this._itemCount;
    if (this.hasWideId) {
      for (let s = 0; s < count; s++) {
        if (this.itemActive[s] === 1 && this.itemIdWide[s] === id) {
          this.itemActive[s] = 0;
          this._activeCount--;
          disabled++;
        }
      }
      return disabled;
    }
    const idI32 = id | 0;
    if (idI32 !== id) return 0;
    for (let s = 0; s < count; s++) {
      if (this.itemActive[s] === 1 && this.itemId[s] === idI32) {
        this.itemActive[s] = 0;
        this._activeCount--;
        disabled++;
      }
    }
    return disabled;
  }

  isSlotActive(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this._itemCount) {
      return false;
    }
    return this.itemActive[slot] === 1;
  }

  queryAABB(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    mask: number,
    outIds: Uint32Array | Int32Array,
    outSlots?: Int32Array,
  ): number {
    const maxOut = outSlots !== undefined ? Math.min(outIds.length, outSlots.length) : outIds.length;
    if (maxOut <= 0 || (mask | 0) === 0 || this._activeCount === 0) {
      return 0;
    }
    if (!(minX <= maxX && minY <= maxY && minZ <= maxZ)) {
      return 0;
    }

    const qMinX = Math.min(minX, Math.fround(minX));
    const qMaxX = Math.max(maxX, Math.fround(maxX));
    const qMinY = Math.min(minY, Math.fround(minY));
    const qMaxY = Math.max(maxY, Math.fround(maxY));
    const qMinZ = Math.min(minZ, Math.fround(minZ));
    const qMaxZ = Math.max(maxZ, Math.fround(maxZ));

    const stamp = this.nextStamp();
    const wide = this.hasWideId;
    let count = 0;

    if (
      this.outOfBoundsCount > 0 &&
      (qMinX < this.minX || qMaxX > this.maxX || qMinZ < this.minZ || qMaxZ > this.maxZ)
    ) {
      const oobLen = this.outOfBoundsCount;
      for (let i = 0; i < oobLen; i++) {
        const s = this.outOfBoundsSlots[i];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        this.itemStamp[s] = stamp;
        if (
          qMinX <= this.itemMaxX[s] &&
          qMaxX >= this.itemMinX[s] &&
          qMinY <= this.itemMaxY[s] &&
          qMaxY >= this.itemMinY[s] &&
          qMinZ <= this.itemMaxZ[s] &&
          qMaxZ >= this.itemMinZ[s]
        ) {
          outIds[count] = wide ? this.itemIdWide[s] : this.itemId[s];
          if (outSlots !== undefined) outSlots[count] = s;
          count++;
          if (count >= maxOut) return count;
        }
      }
    }

    if (qMaxX < this.minX || qMinX > this.maxX || qMaxZ < this.minZ || qMinZ > this.maxZ) {
      return count;
    }

    const cx0 = this.clampCellX(qMinX);
    const cx1 = this.clampCellX(qMaxX);
    const cz0 = this.clampCellZ(qMinZ);
    const cz1 = this.clampCellZ(qMaxZ);
    const cols = this.cols;

    for (let cz = cz0; cz <= cz1; cz++) {
      const rowOffset = cz * cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        let node = this.cellHeads[rowOffset + cx];
        while (node !== -1) {
          const s = this.nodeItem[node];
          node = this.nodeNext[node];
          if (this.itemStamp[s] === stamp) continue;
          this.itemStamp[s] = stamp;
          if (this.itemActive[s] === 0) continue;
          if ((this.layerMask[s] & mask) === 0) continue;
          if (
            qMinX <= this.itemMaxX[s] &&
            qMaxX >= this.itemMinX[s] &&
            qMinY <= this.itemMaxY[s] &&
            qMaxY >= this.itemMinY[s] &&
            qMinZ <= this.itemMaxZ[s] &&
            qMaxZ >= this.itemMinZ[s]
          ) {
            outIds[count] = wide ? this.itemIdWide[s] : this.itemId[s];
            if (outSlots !== undefined) outSlots[count] = s;
            count++;
            if (count >= maxOut) return count;
          }
        }
      }
    }

    return count;
  }

  querySphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    mask: number,
    outIds: Uint32Array | Int32Array,
    outSlots?: Int32Array,
  ): number {
    const maxOut = outSlots !== undefined ? Math.min(outIds.length, outSlots.length) : outIds.length;
    if (maxOut <= 0 || (mask | 0) === 0 || this._activeCount === 0) {
      return 0;
    }
    if (!(radius >= 0) || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz) || !Number.isFinite(radius)) {
      return 0;
    }

    const rSq = radius * radius;
    const qMinX = cx - radius;
    const qMaxX = cx + radius;
    const qMinZ = cz - radius;
    const qMaxZ = cz + radius;

    const stamp = this.nextStamp();
    const wide = this.hasWideId;
    let count = 0;

    if (
      this.outOfBoundsCount > 0 &&
      (qMinX < this.minX || qMaxX > this.maxX || qMinZ < this.minZ || qMaxZ > this.maxZ)
    ) {
      const oobLen = this.outOfBoundsCount;
      for (let i = 0; i < oobLen; i++) {
        const s = this.outOfBoundsSlots[i];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        this.itemStamp[s] = stamp;

        const bx0 = this.itemMinX[s];
        const bx1 = this.itemMaxX[s];
        const by0 = this.itemMinY[s];
        const by1 = this.itemMaxY[s];
        const bz0 = this.itemMinZ[s];
        const bz1 = this.itemMaxZ[s];

        const dx = cx < bx0 ? bx0 - cx : cx > bx1 ? cx - bx1 : 0;
        const dy = cy < by0 ? by0 - cy : cy > by1 ? cy - by1 : 0;
        const dz = cz < bz0 ? bz0 - cz : cz > bz1 ? cz - bz1 : 0;

        if (dx * dx + dy * dy + dz * dz <= rSq) {
          outIds[count] = wide ? this.itemIdWide[s] : this.itemId[s];
          if (outSlots !== undefined) outSlots[count] = s;
          count++;
          if (count >= maxOut) return count;
        }
      }
    }

    if (qMaxX < this.minX || qMinX > this.maxX || qMaxZ < this.minZ || qMinZ > this.maxZ) {
      return count;
    }

    const cx0 = this.clampCellX(qMinX);
    const cx1 = this.clampCellX(qMaxX);
    const cz0 = this.clampCellZ(qMinZ);
    const cz1 = this.clampCellZ(qMaxZ);
    const cols = this.cols;

    for (let cellZ = cz0; cellZ <= cz1; cellZ++) {
      const rowOffset = cellZ * cols;
      for (let cellX = cx0; cellX <= cx1; cellX++) {
        let node = this.cellHeads[rowOffset + cellX];
        while (node !== -1) {
          const s = this.nodeItem[node];
          node = this.nodeNext[node];
          if (this.itemStamp[s] === stamp) continue;
          this.itemStamp[s] = stamp;
          if (this.itemActive[s] === 0) continue;
          if ((this.layerMask[s] & mask) === 0) continue;

          const bx0 = this.itemMinX[s];
          const bx1 = this.itemMaxX[s];
          const by0 = this.itemMinY[s];
          const by1 = this.itemMaxY[s];
          const bz0 = this.itemMinZ[s];
          const bz1 = this.itemMaxZ[s];

          const dx = cx < bx0 ? bx0 - cx : cx > bx1 ? cx - bx1 : 0;
          const dy = cy < by0 ? by0 - cy : cy > by1 ? cy - by1 : 0;
          const dz = cz < bz0 ? bz0 - cz : cz > bz1 ? cz - bz1 : 0;

          if (dx * dx + dy * dy + dz * dz <= rSq) {
            outIds[count] = wide ? this.itemIdWide[s] : this.itemId[s];
            if (outSlots !== undefined) outSlots[count] = s;
            count++;
            if (count >= maxOut) return count;
          }
        }
      }
    }

    return count;
  }

  queryCapsule(
    x: number,
    baseY: number,
    z: number,
    radius: number,
    height: number,
    mask: number,
    outIds: Uint32Array | Int32Array,
    outSlots?: Int32Array,
  ): number {
    const maxOut = outSlots !== undefined ? Math.min(outIds.length, outSlots.length) : outIds.length;
    if (maxOut <= 0 || (mask | 0) === 0 || this._activeCount === 0) {
      return 0;
    }
    if (
      !(radius >= 0) ||
      !(height >= 0) ||
      !Number.isFinite(x) ||
      !Number.isFinite(baseY) ||
      !Number.isFinite(z) ||
      !Number.isFinite(radius) ||
      !Number.isFinite(height)
    ) {
      return 0;
    }

    const segY0 = baseY + radius;
    const segY1 = baseY + Math.max(radius, height - radius);
    const rSq = radius * radius;
    const qMinX = x - radius;
    const qMaxX = x + radius;
    const qMinZ = z - radius;
    const qMaxZ = z + radius;

    const stamp = this.nextStamp();
    const wide = this.hasWideId;
    let count = 0;

    if (
      this.outOfBoundsCount > 0 &&
      (qMinX < this.minX || qMaxX > this.maxX || qMinZ < this.minZ || qMaxZ > this.maxZ)
    ) {
      const oobLen = this.outOfBoundsCount;
      for (let i = 0; i < oobLen; i++) {
        const s = this.outOfBoundsSlots[i];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        this.itemStamp[s] = stamp;

        const bx0 = this.itemMinX[s];
        const bx1 = this.itemMaxX[s];
        const by0 = this.itemMinY[s];
        const by1 = this.itemMaxY[s];
        const bz0 = this.itemMinZ[s];
        const bz1 = this.itemMaxZ[s];

        const dx = x < bx0 ? bx0 - x : x > bx1 ? x - bx1 : 0;
        const dy = segY1 < by0 ? by0 - segY1 : segY0 > by1 ? segY0 - by1 : 0;
        const dz = z < bz0 ? bz0 - z : z > bz1 ? z - bz1 : 0;

        if (dx * dx + dy * dy + dz * dz <= rSq) {
          outIds[count] = wide ? this.itemIdWide[s] : this.itemId[s];
          if (outSlots !== undefined) outSlots[count] = s;
          count++;
          if (count >= maxOut) return count;
        }
      }
    }

    if (qMaxX < this.minX || qMinX > this.maxX || qMaxZ < this.minZ || qMinZ > this.maxZ) {
      return count;
    }

    const cx0 = this.clampCellX(qMinX);
    const cx1 = this.clampCellX(qMaxX);
    const cz0 = this.clampCellZ(qMinZ);
    const cz1 = this.clampCellZ(qMaxZ);
    const cols = this.cols;

    for (let cellZ = cz0; cellZ <= cz1; cellZ++) {
      const rowOffset = cellZ * cols;
      for (let cellX = cx0; cellX <= cx1; cellX++) {
        let node = this.cellHeads[rowOffset + cellX];
        while (node !== -1) {
          const s = this.nodeItem[node];
          node = this.nodeNext[node];
          if (this.itemStamp[s] === stamp) continue;
          this.itemStamp[s] = stamp;
          if (this.itemActive[s] === 0) continue;
          if ((this.layerMask[s] & mask) === 0) continue;

          const bx0 = this.itemMinX[s];
          const bx1 = this.itemMaxX[s];
          const by0 = this.itemMinY[s];
          const by1 = this.itemMaxY[s];
          const bz0 = this.itemMinZ[s];
          const bz1 = this.itemMaxZ[s];

          const dx = x < bx0 ? bx0 - x : x > bx1 ? x - bx1 : 0;
          const dy = segY1 < by0 ? by0 - segY1 : segY0 > by1 ? segY0 - by1 : 0;
          const dz = z < bz0 ? bz0 - z : z > bz1 ? z - bz1 : 0;

          if (dx * dx + dy * dy + dz * dz <= rSq) {
            outIds[count] = wide ? this.itemIdWide[s] : this.itemId[s];
            if (outSlots !== undefined) outSlots[count] = s;
            count++;
            if (count >= maxOut) return count;
          }
        }
      }
    }

    return count;
  }

  sampleGroundHeight(
    x: number,
    z: number,
    maxY: number,
    defaultGroundY: number,
    mask: number,
    outSample?: GroundSampleHit,
  ): GroundSampleHit {
    const out = outSample ?? createGroundSampleHit();
    out.found = false;
    out.groundY = defaultGroundY;
    out.id = 0;
    out.slot = -1;

    if ((mask | 0) === 0 || this._activeCount === 0 || !Number.isFinite(x) || !Number.isFinite(z) || Number.isNaN(maxY)) {
      return out;
    }

    const xLo = Math.min(x, Math.fround(x));
    const xHi = Math.max(x, Math.fround(x));
    const zLo = Math.min(z, Math.fround(z));
    const zHi = Math.max(z, Math.fround(z));
    const maxYBound = Math.max(maxY, Math.fround(maxY));
    const wide = this.hasWideId;

    let bestY = -Infinity;
    let bestSlot = -1;
    let bestId = 0;

    if (this.outOfBoundsCount > 0 && (xLo < this.minX || xHi > this.maxX || zLo < this.minZ || zHi > this.maxZ)) {
      const oobLen = this.outOfBoundsCount;
      for (let i = 0; i < oobLen; i++) {
        const s = this.outOfBoundsSlots[i];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        if (
          xHi >= this.itemMinX[s] &&
          xLo <= this.itemMaxX[s] &&
          zHi >= this.itemMinZ[s] &&
          zLo <= this.itemMaxZ[s]
        ) {
          const topY = this.itemMaxY[s];
          if (topY <= maxYBound && (topY > bestY || (topY === bestY && s < bestSlot))) {
            bestY = topY;
            bestSlot = s;
            bestId = wide ? this.itemIdWide[s] : this.itemId[s];
          }
        }
      }
    }

    if (xHi >= this.minX && xLo <= this.maxX && zHi >= this.minZ && zLo <= this.maxZ) {
      const cx = this.clampCellX(x);
      const cz = this.clampCellZ(z);
      let node = this.cellHeads[cz * this.cols + cx];
      while (node !== -1) {
        const s = this.nodeItem[node];
        node = this.nodeNext[node];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        if (
          xHi >= this.itemMinX[s] &&
          xLo <= this.itemMaxX[s] &&
          zHi >= this.itemMinZ[s] &&
          zLo <= this.itemMaxZ[s]
        ) {
          const topY = this.itemMaxY[s];
          if (topY <= maxYBound && (topY > bestY || (topY === bestY && s < bestSlot))) {
            bestY = topY;
            bestSlot = s;
            bestId = wide ? this.itemIdWide[s] : this.itemId[s];
          }
        }
      }
    }

    if (bestSlot !== -1) {
      out.found = true;
      out.groundY = bestY;
      out.id = bestId;
      out.slot = bestSlot;
    }

    return out;
  }

  raycastAABB(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    mask: number,
    outHit: SpatialRayHit,
    opts?: RaycastOptions,
  ): boolean {
    if (
      (mask | 0) === 0 ||
      this._activeCount === 0 ||
      !(maxDist >= 0) ||
      !Number.isFinite(ox) ||
      !Number.isFinite(oy) ||
      !Number.isFinite(oz) ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      !Number.isFinite(dz)
    ) {
      return this.resetRayHit(outHit);
    }

    const lenSq = dx * dx + dy * dy + dz * dz;
    if (!(lenSq > 0)) {
      return this.resetRayHit(outHit);
    }

    let ux = dx;
    let uy = dy;
    let uz = dz;
    if (Math.abs(lenSq - 1) > 1e-12) {
      const invLen = 1 / Math.sqrt(lenSq);
      ux = dx * invLen;
      uy = dy * invLen;
      uz = dz * invLen;
    }

    const ignoreInsideOrigin = opts?.ignoreInsideOrigin ?? true;
    const hasIgnoreId = opts?.ignoreId !== undefined;
    const ignoreId = opts?.ignoreId ?? 0;
    const wide = this.hasWideId;
    const ignoreIdI32 = ignoreId | 0;
    const checkIgnore = hasIgnoreId && (wide || ignoreIdI32 === ignoreId);

    const xParallel = Math.abs(ux) < RAY_DIR_EPS;
    const yParallel = Math.abs(uy) < RAY_DIR_EPS;
    const zParallel = Math.abs(uz) < RAY_DIR_EPS;
    const invUx = xParallel ? 0 : 1 / ux;
    const invUy = yParallel ? 0 : 1 / uy;
    const invUz = zParallel ? 0 : 1 / uz;

    const stamp = this.nextStamp();
    let bestDist = maxDist;
    let bestSlot = -1;
    let bestNx = 0;
    let bestNy = 0;
    let bestNz = 0;

    // 1. Check any items extending outside the 2D XZ grid first so early-exit inside DDA remains exact.
    if (this.outOfBoundsCount > 0) {
      const oobLen = this.outOfBoundsCount;
      for (let i = 0; i < oobLen; i++) {
        const s = this.outOfBoundsSlots[i];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        if (checkIgnore && (wide ? this.itemIdWide[s] === ignoreId : this.itemId[s] === ignoreIdI32)) {
          this.itemStamp[s] = stamp;
          continue;
        }
        this.itemStamp[s] = stamp;

        const bx0 = this.itemMinX[s];
        const bx1 = this.itemMaxX[s];
        if (xParallel && (ox < bx0 || ox > bx1)) continue;

        const by0 = this.itemMinY[s];
        const by1 = this.itemMaxY[s];
        if (yParallel && (oy < by0 || oy > by1)) continue;

        const bz0 = this.itemMinZ[s];
        const bz1 = this.itemMaxZ[s];
        if (zParallel && (oz < bz0 || oz > bz1)) continue;

        let tEnter = -Infinity;
        let tExit = Infinity;
        let nx = 0;
        let ny = 0;
        let nz = 0;

        if (!xParallel) {
          const tx0 = (ux > 0 ? bx0 - ox : bx1 - ox) * invUx;
          const tx1 = (ux > 0 ? bx1 - ox : bx0 - ox) * invUx;
          if (tx0 > tEnter) {
            tEnter = tx0;
            nx = ux > 0 ? -1 : 1;
            ny = 0;
            nz = 0;
          }
          if (tx1 < tExit) tExit = tx1;
        }

        if (!yParallel) {
          const ty0 = (uy > 0 ? by0 - oy : by1 - oy) * invUy;
          const ty1 = (uy > 0 ? by1 - oy : by0 - oy) * invUy;
          if (ty0 > tEnter) {
            tEnter = ty0;
            nx = 0;
            ny = uy > 0 ? -1 : 1;
            nz = 0;
          }
          if (ty1 < tExit) tExit = ty1;
        }

        if (!zParallel) {
          const tz0 = (uz > 0 ? bz0 - oz : bz1 - oz) * invUz;
          const tz1 = (uz > 0 ? bz1 - oz : bz0 - oz) * invUz;
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
        if (tHit < bestDist || (tHit === bestDist && (bestSlot === -1 || s < bestSlot))) {
          bestDist = tHit;
          bestSlot = s;
          bestNx = nx;
          bestNy = ny;
          bestNz = nz;
        }
      }
    }

    // 2. Clip ray [0, bestDist] against the 2D XZ grid bounds.
    let tGridMin = 0;
    let tGridMax = bestDist;

    if (xParallel) {
      if (ox < this.minX || ox > this.maxX) {
        return this.finalizeRayHit(outHit, ox, oy, oz, ux, uy, uz, bestSlot, bestDist, bestNx, bestNy, bestNz);
      }
    } else {
      const gx0 = (ux > 0 ? this.minX - ox : this.maxX - ox) * invUx;
      const gx1 = (ux > 0 ? this.maxX - ox : this.minX - ox) * invUx;
      if (gx0 > tGridMin) tGridMin = gx0;
      if (gx1 < tGridMax) tGridMax = gx1;
    }

    if (zParallel) {
      if (oz < this.minZ || oz > this.maxZ) {
        return this.finalizeRayHit(outHit, ox, oy, oz, ux, uy, uz, bestSlot, bestDist, bestNx, bestNy, bestNz);
      }
    } else {
      const gz0 = (uz > 0 ? this.minZ - oz : this.maxZ - oz) * invUz;
      const gz1 = (uz > 0 ? this.maxZ - oz : this.minZ - oz) * invUz;
      if (gz0 > tGridMin) tGridMin = gz0;
      if (gz1 < tGridMax) tGridMax = gz1;
    }

    if (tGridMax < tGridMin) {
      return this.finalizeRayHit(outHit, ox, oy, oz, ux, uy, uz, bestSlot, bestDist, bestNx, bestNy, bestNz);
    }

    // 3. Amanatides & Woo 2D XZ DDA traversal.
    const startX = ox + tGridMin * ux;
    const startZ = oz + tGridMin * uz;

    let cx = this.clampCellX(startX);
    let cz = this.clampCellZ(startZ);

    const stepX = xParallel ? 0 : ux > 0 ? 1 : -1;
    const stepZ = zParallel ? 0 : uz > 0 ? 1 : -1;

    let tMaxX = Infinity;
    let tDeltaX = Infinity;
    if (stepX > 0) {
      const nextBoundaryX = this.minX + (cx + 1) * this.cellSize;
      tMaxX = (nextBoundaryX - ox) * invUx;
      tDeltaX = this.cellSize * invUx;
    } else if (stepX < 0) {
      const nextBoundaryX = this.minX + cx * this.cellSize;
      tMaxX = (nextBoundaryX - ox) * invUx;
      tDeltaX = -this.cellSize * invUx;
    }

    let tMaxZ = Infinity;
    let tDeltaZ = Infinity;
    if (stepZ > 0) {
      const nextBoundaryZ = this.minZ + (cz + 1) * this.cellSize;
      tMaxZ = (nextBoundaryZ - oz) * invUz;
      tDeltaZ = this.cellSize * invUz;
    } else if (stepZ < 0) {
      const nextBoundaryZ = this.minZ + cz * this.cellSize;
      tMaxZ = (nextBoundaryZ - oz) * invUz;
      tDeltaZ = -this.cellSize * invUz;
    }

    const cols = this.cols;
    const rows = this.rows;

    while (cx >= 0 && cx < cols && cz >= 0 && cz < rows) {
      let node = this.cellHeads[cz * cols + cx];
      while (node !== -1) {
        const s = this.nodeItem[node];
        node = this.nodeNext[node];
        if (this.itemStamp[s] === stamp) continue;
        this.itemStamp[s] = stamp;
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        if (checkIgnore && (wide ? this.itemIdWide[s] === ignoreId : this.itemId[s] === ignoreIdI32)) continue;

        const bx0 = this.itemMinX[s];
        const bx1 = this.itemMaxX[s];
        if (xParallel && (ox < bx0 || ox > bx1)) continue;

        const by0 = this.itemMinY[s];
        const by1 = this.itemMaxY[s];
        if (yParallel && (oy < by0 || oy > by1)) continue;

        const bz0 = this.itemMinZ[s];
        const bz1 = this.itemMaxZ[s];
        if (zParallel && (oz < bz0 || oz > bz1)) continue;

        let tEnter = -Infinity;
        let tExit = Infinity;
        let nx = 0;
        let ny = 0;
        let nz = 0;

        if (!xParallel) {
          const tx0 = (ux > 0 ? bx0 - ox : bx1 - ox) * invUx;
          const tx1 = (ux > 0 ? bx1 - ox : bx0 - ox) * invUx;
          if (tx0 > tEnter) {
            tEnter = tx0;
            nx = ux > 0 ? -1 : 1;
            ny = 0;
            nz = 0;
          }
          if (tx1 < tExit) tExit = tx1;
        }

        if (!yParallel) {
          const ty0 = (uy > 0 ? by0 - oy : by1 - oy) * invUy;
          const ty1 = (uy > 0 ? by1 - oy : by0 - oy) * invUy;
          if (ty0 > tEnter) {
            tEnter = ty0;
            nx = 0;
            ny = uy > 0 ? -1 : 1;
            nz = 0;
          }
          if (ty1 < tExit) tExit = ty1;
        }

        if (!zParallel) {
          const tz0 = (uz > 0 ? bz0 - oz : bz1 - oz) * invUz;
          const tz1 = (uz > 0 ? bz1 - oz : bz0 - oz) * invUz;
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
        if (tHit < bestDist || (tHit === bestDist && (bestSlot === -1 || s < bestSlot))) {
          bestDist = tHit;
          bestSlot = s;
          bestNx = nx;
          bestNy = ny;
          bestNz = nz;
        }
      }

      const nextCellT = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (bestSlot !== -1 && bestDist < nextCellT) {
        break;
      }
      if (nextCellT > bestDist) {
        break;
      }

      if (stepX !== 0 && stepZ !== 0 && Math.abs(tMaxX - tMaxZ) <= DDA_CORNER_EPS) {
        // Supercover corner guard when ray crosses within 1 um of a 4-cell grid vertex.
        const adjX = cx + stepX;
        const adjZ = cz + stepZ;
        if (adjX >= 0 && adjX < cols) {
          let adjNode = this.cellHeads[cz * cols + adjX];
          while (adjNode !== -1) {
            const s = this.nodeItem[adjNode];
            adjNode = this.nodeNext[adjNode];
            if (this.itemStamp[s] === stamp) continue;
            this.itemStamp[s] = stamp;
            if (this.itemActive[s] === 0) continue;
            if ((this.layerMask[s] & mask) === 0) continue;
            if (checkIgnore && (wide ? this.itemIdWide[s] === ignoreId : this.itemId[s] === ignoreIdI32)) continue;

            const hitRes = this.testRaySlot(
              s,
              ox,
              oy,
              oz,
              ux,
              uy,
              uz,
              xParallel,
              yParallel,
              zParallel,
              invUx,
              invUy,
              invUz,
              ignoreInsideOrigin,
              bestDist,
              bestSlot,
            );
            if (hitRes >= 0) {
              bestDist = hitRes;
              bestSlot = s;
              bestNx = this.lastSlabNx;
              bestNy = this.lastSlabNy;
              bestNz = this.lastSlabNz;
            }
          }
        }
        if (adjZ >= 0 && adjZ < rows) {
          let adjNode = this.cellHeads[adjZ * cols + cx];
          while (adjNode !== -1) {
            const s = this.nodeItem[adjNode];
            adjNode = this.nodeNext[adjNode];
            if (this.itemStamp[s] === stamp) continue;
            this.itemStamp[s] = stamp;
            if (this.itemActive[s] === 0) continue;
            if ((this.layerMask[s] & mask) === 0) continue;
            if (checkIgnore && (wide ? this.itemIdWide[s] === ignoreId : this.itemId[s] === ignoreIdI32)) continue;

            const hitRes = this.testRaySlot(
              s,
              ox,
              oy,
              oz,
              ux,
              uy,
              uz,
              xParallel,
              yParallel,
              zParallel,
              invUx,
              invUy,
              invUz,
              ignoreInsideOrigin,
              bestDist,
              bestSlot,
            );
            if (hitRes >= 0) {
              bestDist = hitRes;
              bestSlot = s;
              bestNx = this.lastSlabNx;
              bestNy = this.lastSlabNy;
              bestNz = this.lastSlabNz;
            }
          }
        }
        cx += stepX;
        cz += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }

    return this.finalizeRayHit(outHit, ox, oy, oz, ux, uy, uz, bestSlot, bestDist, bestNx, bestNy, bestNz);
  }

  resolveCapsuleStatic(
    x: number,
    baseY: number,
    z: number,
    radius: number,
    height: number,
    mask: number,
    outResult: CapsuleCollisionResult,
    stepHeight = DEFAULT_STEP_HEIGHT,
  ): CapsuleCollisionResult {
    outResult.collided = false;
    outResult.grounded = false;
    outResult.resolvedX = x;
    outResult.resolvedBaseY = baseY;
    outResult.resolvedZ = z;
    outResult.normalX = 0;
    outResult.normalY = 0;
    outResult.normalZ = 0;
    outResult.hitCount = 0;

    if (
      (mask | 0) === 0 ||
      this._activeCount === 0 ||
      !(radius >= 0) ||
      !(height >= 0) ||
      !Number.isFinite(x) ||
      !Number.isFinite(baseY) ||
      !Number.isFinite(z) ||
      !Number.isFinite(radius) ||
      !Number.isFinite(height) ||
      !Number.isFinite(stepHeight)
    ) {
      return outResult;
    }

    const r = radius;
    const effHeight = Math.max(2 * r, height);
    const maxStep = stepHeight > 0 ? stepHeight : 0;

    const broadPadXZ = r * 3 + 0.5;
    const candidateCount = this.gatherCandidates(
      x - broadPadXZ,
      baseY - effHeight - 0.5,
      z - broadPadXZ,
      x + broadPadXZ,
      baseY + effHeight + maxStep + 0.5,
      z + broadPadXZ,
      mask,
    );

    if (candidateCount === 0) {
      return outResult;
    }

    let rx = x;
    let ry = baseY;
    let rz = z;

    let accumNx = 0;
    let accumNy = 0;
    let accumNz = 0;
    let lastNx = 0;
    let lastNy = 0;
    let lastNz = 0;
    let hitSlotCount = 0;
    let collided = false;

    const candidates = this.scratchSlots;
    const hitSlots = this.scratchHitSlots;

    for (let iter = 0; iter < SOLVER_MAX_ITERATIONS; iter++) {
      let movedInIter = false;

      // Pass A: Floors, ceilings, and non-steppable horizontal walls/corners.
      for (let i = 0; i < candidateCount; i++) {
        const s = candidates[i];
        const bx0 = this.itemMinX[s];
        const bx1 = this.itemMaxX[s];
        const by0 = this.itemMinY[s];
        const by1 = this.itemMaxY[s];
        const bz0 = this.itemMinZ[s];
        const bz1 = this.itemMaxZ[s];

        const penUp = by1 - ry;
        const penDown = ry + effHeight - by0;
        if (penUp <= PENETRATION_EPS || penDown <= PENETRATION_EPS) continue;

        const qx = rx < bx0 ? bx0 : rx > bx1 ? bx1 : rx;
        const qz = rz < bz0 ? bz0 : rz > bz1 ? bz1 : rz;
        const dx = rx - qx;
        const dz = rz - qz;
        const distSqXZ = dx * dx + dz * dz;

        let penXZ = 0;
        let nxXZ = 0;
        let nzXZ = 0;

        if (distSqXZ > 1e-12) {
          if (distSqXZ >= r * r) continue;
          const distXZ = Math.sqrt(distSqXZ);
          penXZ = r - distXZ;
          if (penXZ <= PENETRATION_EPS) continue;
          nxXZ = dx / distXZ;
          nzXZ = dz / distXZ;
        } else {
          // Center (rx, rz) lies inside [bx0, bx1] x [bz0, bz1].
          const penLeft = rx - bx0 + r;
          const penRight = bx1 - rx + r;
          const penBack = rz - bz0 + r;
          const penFront = bz1 - rz + r;

          penXZ = penLeft;
          nxXZ = -1;
          nzXZ = 0;
          if (penRight < penXZ) {
            penXZ = penRight;
            nxXZ = 1;
            nzXZ = 0;
          }
          if (penBack < penXZ) {
            penXZ = penBack;
            nxXZ = 0;
            nzXZ = -1;
          }
          if (penFront < penXZ) {
            penXZ = penFront;
            nxXZ = 0;
            nzXZ = 1;
          }
          if (penXZ <= PENETRATION_EPS) continue;
        }

        if (penUp <= penDown && penUp <= penXZ) {
          // Floor landing (upward MTV).
          ry = by1;
          accumNy += penUp;
          lastNx = 0;
          lastNy = 1;
          lastNz = 0;
          hitSlotCount = this.recordHitSlot(hitSlots, hitSlotCount, s);
          collided = true;
          movedInIter = true;
        } else if (penDown < penUp && penDown <= penXZ) {
          // Ceiling clamp (downward MTV).
          ry = by0 - effHeight;
          accumNy -= penDown;
          lastNx = 0;
          lastNy = -1;
          lastNz = 0;
          hitSlotCount = this.recordHitSlot(hitSlots, hitSlotCount, s);
          collided = true;
          movedInIter = true;
        } else if (maxStep > 0 && penUp <= maxStep && penUp < penDown) {
          // Defer low step candidate to Pass B after adjacent tall walls push out XZ.
          continue;
        } else {
          // Horizontal wall / corner push-out.
          rx += nxXZ * penXZ;
          rz += nzXZ * penXZ;
          accumNx += nxXZ * penXZ;
          accumNz += nzXZ * penXZ;
          lastNx = nxXZ;
          lastNy = 0;
          lastNz = nzXZ;
          hitSlotCount = this.recordHitSlot(hitSlots, hitSlotCount, s);
          collided = true;
          movedInIter = true;
        }
      }

      // Pass B: Stair step-up on remaining low obstacles (penUp <= maxStep).
      // Resolve the highest overlapping steppable surface first so stacked/adjacent risers do not block lower treads.
      if (maxStep > 0) {
        let bestStepSlot = -1;
        let bestStepTopY = -Infinity;
        let bestStepPenXZ = 0;
        let bestStepNx = 0;
        let bestStepNz = 0;

        for (let i = 0; i < candidateCount; i++) {
          const s = candidates[i];
          const by0 = this.itemMinY[s];
          const by1 = this.itemMaxY[s];

          const penUp = by1 - ry;
          const penDown = ry + effHeight - by0;
          if (penUp <= PENETRATION_EPS || penDown <= PENETRATION_EPS || penUp > maxStep || penUp >= penDown) {
            continue;
          }
          if (by1 <= bestStepTopY) {
            continue;
          }

          const bx0 = this.itemMinX[s];
          const bx1 = this.itemMaxX[s];
          const bz0 = this.itemMinZ[s];
          const bz1 = this.itemMaxZ[s];

          const qx = rx < bx0 ? bx0 : rx > bx1 ? bx1 : rx;
          const qz = rz < bz0 ? bz0 : rz > bz1 ? bz1 : rz;
          const dx = rx - qx;
          const dz = rz - qz;
          const distSqXZ = dx * dx + dz * dz;

          let penXZ = 0;
          let nxXZ = 0;
          let nzXZ = 0;

          if (distSqXZ > 1e-12) {
            if (distSqXZ >= r * r) continue;
            const distXZ = Math.sqrt(distSqXZ);
            penXZ = r - distXZ;
            if (penXZ <= PENETRATION_EPS) continue;
            nxXZ = dx / distXZ;
            nzXZ = dz / distXZ;
          } else {
            const penLeft = rx - bx0 + r;
            const penRight = bx1 - rx + r;
            const penBack = rz - bz0 + r;
            const penFront = bz1 - rz + r;

            penXZ = penLeft;
            nxXZ = -1;
            nzXZ = 0;
            if (penRight < penXZ) {
              penXZ = penRight;
              nxXZ = 1;
              nzXZ = 0;
            }
            if (penBack < penXZ) {
              penXZ = penBack;
              nxXZ = 0;
              nzXZ = -1;
            }
            if (penFront < penXZ) {
              penXZ = penFront;
              nxXZ = 0;
              nzXZ = 1;
            }
            if (penXZ <= PENETRATION_EPS) continue;
          }

          bestStepSlot = s;
          bestStepTopY = by1;
          bestStepPenXZ = penXZ;
          bestStepNx = nxXZ;
          bestStepNz = nzXZ;
        }

        if (bestStepSlot !== -1) {
          if (this.hasStepHeadroom(rx, bestStepTopY, rz, r, effHeight, candidateCount, bestStepSlot)) {
            const lift = bestStepTopY - ry;
            ry = bestStepTopY;
            accumNy += lift;
            lastNx = 0;
            lastNy = 1;
            lastNz = 0;
            hitSlotCount = this.recordHitSlot(hitSlots, hitSlotCount, bestStepSlot);
            collided = true;
            movedInIter = true;
          } else {
            // Headroom blocked by ceiling/obstacle above step: fall back to horizontal push-out.
            rx += bestStepNx * bestStepPenXZ;
            rz += bestStepNz * bestStepPenXZ;
            accumNx += bestStepNx * bestStepPenXZ;
            accumNz += bestStepNz * bestStepPenXZ;
            lastNx = bestStepNx;
            lastNy = 0;
            lastNz = bestStepNz;
            hitSlotCount = this.recordHitSlot(hitSlots, hitSlotCount, bestStepSlot);
            collided = true;
            movedInIter = true;
          }
        }
      }

      if (!movedInIter) {
        break;
      }
    }

    // Grounded support check at final resolved pose (rx, ry, rz).
    let grounded = false;
    const innerR = r > FOOTPRINT_SKIN_EPS ? r - FOOTPRINT_SKIN_EPS : 0;
    const innerRSq = innerR * innerR;
    for (let i = 0; i < candidateCount; i++) {
      const s = candidates[i];
      const topY = this.itemMaxY[s];
      if (Math.abs(ry - topY) <= GROUND_CONTACT_EPS && ry + effHeight > topY) {
        const bx0 = this.itemMinX[s];
        const bx1 = this.itemMaxX[s];
        const bz0 = this.itemMinZ[s];
        const bz1 = this.itemMaxZ[s];
        const qx = rx < bx0 ? bx0 : rx > bx1 ? bx1 : rx;
        const qz = rz < bz0 ? bz0 : rz > bz1 ? bz1 : rz;
        const dx = rx - qx;
        const dz = rz - qz;
        if (dx * dx + dz * dz <= innerRSq) {
          grounded = true;
          break;
        }
      }
    }

    outResult.collided = collided;
    outResult.grounded = grounded;
    outResult.resolvedX = rx;
    outResult.resolvedBaseY = ry;
    outResult.resolvedZ = rz;
    outResult.hitCount = hitSlotCount;

    if (collided) {
      const nLenSq = accumNx * accumNx + accumNy * accumNy + accumNz * accumNz;
      if (nLenSq > 1e-16) {
        const nLen = Math.sqrt(nLenSq);
        outResult.normalX = accumNx / nLen;
        outResult.normalY = accumNy / nLen;
        outResult.normalZ = accumNz / nLen;
      } else {
        outResult.normalX = lastNx;
        outResult.normalY = lastNy;
        outResult.normalZ = lastNz;
      }
    }

    return outResult;
  }

  private lastSlabNx = 0;
  private lastSlabNy = 0;
  private lastSlabNz = 0;

  private resetRayHit(outHit: SpatialRayHit): false {
    outHit.hit = false;
    outHit.id = 0;
    outHit.slot = -1;
    outHit.distance = 0;
    outHit.pointX = 0;
    outHit.pointY = 0;
    outHit.pointZ = 0;
    outHit.normalX = 0;
    outHit.normalY = 0;
    outHit.normalZ = 0;
    return false;
  }

  private testRaySlot(
    s: number,
    ox: number,
    oy: number,
    oz: number,
    ux: number,
    uy: number,
    uz: number,
    xParallel: boolean,
    yParallel: boolean,
    zParallel: boolean,
    invUx: number,
    invUy: number,
    invUz: number,
    ignoreInsideOrigin: boolean,
    bestDist: number,
    bestSlot: number,
  ): number {
    const bx0 = this.itemMinX[s];
    const bx1 = this.itemMaxX[s];
    if (xParallel && (ox < bx0 || ox > bx1)) return -1;

    const by0 = this.itemMinY[s];
    const by1 = this.itemMaxY[s];
    if (yParallel && (oy < by0 || oy > by1)) return -1;

    const bz0 = this.itemMinZ[s];
    const bz1 = this.itemMaxZ[s];
    if (zParallel && (oz < bz0 || oz > bz1)) return -1;

    let tEnter = -Infinity;
    let tExit = Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    if (!xParallel) {
      const tx0 = (ux > 0 ? bx0 - ox : bx1 - ox) * invUx;
      const tx1 = (ux > 0 ? bx1 - ox : bx0 - ox) * invUx;
      if (tx0 > tEnter) {
        tEnter = tx0;
        nx = ux > 0 ? -1 : 1;
        ny = 0;
        nz = 0;
      }
      if (tx1 < tExit) tExit = tx1;
    }

    if (!yParallel) {
      const ty0 = (uy > 0 ? by0 - oy : by1 - oy) * invUy;
      const ty1 = (uy > 0 ? by1 - oy : by0 - oy) * invUy;
      if (ty0 > tEnter) {
        tEnter = ty0;
        nx = 0;
        ny = uy > 0 ? -1 : 1;
        nz = 0;
      }
      if (ty1 < tExit) tExit = ty1;
    }

    if (!zParallel) {
      const tz0 = (uz > 0 ? bz0 - oz : bz1 - oz) * invUz;
      const tz1 = (uz > 0 ? bz1 - oz : bz0 - oz) * invUz;
      if (tz0 > tEnter) {
        tEnter = tz0;
        nx = 0;
        ny = 0;
        nz = uz > 0 ? -1 : 1;
      }
      if (tz1 < tExit) tExit = tz1;
    }

    if (tExit < tEnter || tExit < 0) return -1;
    if (ignoreInsideOrigin && tEnter < 0) return -1;
    const tHit = tEnter < 0 ? 0 : tEnter;
    if (tHit < bestDist || (tHit === bestDist && (bestSlot === -1 || s < bestSlot))) {
      this.lastSlabNx = nx;
      this.lastSlabNy = ny;
      this.lastSlabNz = nz;
      return tHit;
    }
    return -1;
  }

  private finalizeRayHit(
    outHit: SpatialRayHit,
    ox: number,
    oy: number,
    oz: number,
    ux: number,
    uy: number,
    uz: number,
    bestSlot: number,
    bestDist: number,
    bestNx: number,
    bestNy: number,
    bestNz: number,
  ): boolean {
    if (bestSlot === -1) {
      return this.resetRayHit(outHit);
    }
    outHit.hit = true;
    outHit.id = this.hasWideId ? this.itemIdWide[bestSlot] : this.itemId[bestSlot];
    outHit.slot = bestSlot;
    outHit.distance = bestDist;
    outHit.pointX = ox + bestDist * ux;
    outHit.pointY = oy + bestDist * uy;
    outHit.pointZ = oz + bestDist * uz;
    outHit.normalX = bestNx;
    outHit.normalY = bestNy;
    outHit.normalZ = bestNz;
    return true;
  }

  private gatherCandidates(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    mask: number,
  ): number {
    const stamp = this.nextStamp();
    let count = 0;
    const out = this.scratchSlots;

    if (
      this.outOfBoundsCount > 0 &&
      (minX < this.minX || maxX > this.maxX || minZ < this.minZ || maxZ > this.maxZ)
    ) {
      const oobLen = this.outOfBoundsCount;
      for (let i = 0; i < oobLen; i++) {
        const s = this.outOfBoundsSlots[i];
        if (this.itemActive[s] === 0) continue;
        if ((this.layerMask[s] & mask) === 0) continue;
        this.itemStamp[s] = stamp;
        if (
          minX <= this.itemMaxX[s] &&
          maxX >= this.itemMinX[s] &&
          minY <= this.itemMaxY[s] &&
          maxY >= this.itemMinY[s] &&
          minZ <= this.itemMaxZ[s] &&
          maxZ >= this.itemMinZ[s]
        ) {
          out[count++] = s;
        }
      }
    }

    if (maxX >= this.minX && minX <= this.maxX && maxZ >= this.minZ && minZ <= this.maxZ) {
      const cx0 = this.clampCellX(minX);
      const cx1 = this.clampCellX(maxX);
      const cz0 = this.clampCellZ(minZ);
      const cz1 = this.clampCellZ(maxZ);
      const cols = this.cols;

      for (let cz = cz0; cz <= cz1; cz++) {
        const rowOffset = cz * cols;
        for (let cx = cx0; cx <= cx1; cx++) {
          let node = this.cellHeads[rowOffset + cx];
          while (node !== -1) {
            const s = this.nodeItem[node];
            node = this.nodeNext[node];
            if (this.itemStamp[s] === stamp) continue;
            this.itemStamp[s] = stamp;
            if (this.itemActive[s] === 0) continue;
            if ((this.layerMask[s] & mask) === 0) continue;
            if (
              minX <= this.itemMaxX[s] &&
              maxX >= this.itemMinX[s] &&
              minY <= this.itemMaxY[s] &&
              maxY >= this.itemMinY[s] &&
              minZ <= this.itemMaxZ[s] &&
              maxZ >= this.itemMinZ[s]
            ) {
              out[count++] = s;
            }
          }
        }
      }
    }

    // Insertion sort candidate slots ascending for deterministic solver order.
    for (let i = 1; i < count; i++) {
      const key = out[i];
      let j = i - 1;
      while (j >= 0 && out[j] > key) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = key;
    }

    return count;
  }

  private hasStepHeadroom(
    rx: number,
    targetBaseY: number,
    rz: number,
    radius: number,
    effHeight: number,
    candidateCount: number,
    stepSlot: number,
  ): boolean {
    const innerR = radius > FOOTPRINT_SKIN_EPS ? radius - FOOTPRINT_SKIN_EPS : 0;
    const innerRSq = innerR * innerR;
    const y0 = targetBaseY + FOOTPRINT_SKIN_EPS;
    const y1 = targetBaseY + effHeight - FOOTPRINT_SKIN_EPS;
    const candidates = this.scratchSlots;

    for (let i = 0; i < candidateCount; i++) {
      const c = candidates[i];
      if (c === stepSlot) continue;
      if (this.itemMaxY[c] <= y0 || this.itemMinY[c] >= y1) continue;

      const bx0 = this.itemMinX[c];
      const bx1 = this.itemMaxX[c];
      const bz0 = this.itemMinZ[c];
      const bz1 = this.itemMaxZ[c];
      const qx = rx < bx0 ? bx0 : rx > bx1 ? bx1 : rx;
      const qz = rz < bz0 ? bz0 : rz > bz1 ? bz1 : rz;
      const dx = rx - qx;
      const dz = rz - qz;
      if (dx * dx + dz * dz < innerRSq) {
        return false;
      }
    }

    return true;
  }

  private recordHitSlot(hitSlots: Int32Array, count: number, slot: number): number {
    for (let i = 0; i < count; i++) {
      if (hitSlots[i] === slot) return count;
    }
    hitSlots[count] = slot;
    return count + 1;
  }

  private nextStamp(): number {
    let next = (this.queryStamp >>> 0) + 1;
    if (next >= STAMP_WRAP_THRESHOLD) {
      this.itemStamp.fill(0);
      next = 1;
    }
    this.queryStamp = next;
    return next;
  }

  private clampCellX(x: number): number {
    const c = Math.floor((x - this.minX) / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampCellZ(z: number): number {
    const c = Math.floor((z - this.minZ) / this.cellSize);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  private allocNode(): number {
    if (this.freeNodeHead !== -1) {
      const n = this.freeNodeHead;
      this.freeNodeHead = this.nodeNext[n];
      this._nodeCount++;
      return n;
    }
    const n = this.nodePoolTop++;
    this._nodeCount++;
    return n;
  }

  private linkSlotToCells(slot: number, cx0: number, cx1: number, cz0: number, cz1: number): void {
    const cols = this.cols;
    for (let cz = cz0; cz <= cz1; cz++) {
      const rowOffset = cz * cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const cellIdx = rowOffset + cx;
        const n = this.allocNode();
        this.nodeItem[n] = slot;
        this.nodeNext[n] = this.cellHeads[cellIdx];
        this.cellHeads[cellIdx] = n;
      }
    }
  }

  private unlinkSlotFromCells(slot: number, cx0: number, cx1: number, cz0: number, cz1: number): void {
    const cols = this.cols;
    for (let cz = cz0; cz <= cz1; cz++) {
      const rowOffset = cz * cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const cellIdx = rowOffset + cx;
        let prev = -1;
        let curr = this.cellHeads[cellIdx];
        while (curr !== -1) {
          const next = this.nodeNext[curr];
          if (this.nodeItem[curr] === slot) {
            if (prev === -1) {
              this.cellHeads[cellIdx] = next;
            } else {
              this.nodeNext[prev] = next;
            }
            this.nodeNext[curr] = this.freeNodeHead;
            this.freeNodeHead = curr;
            this._nodeCount--;
            break;
          }
          prev = curr;
          curr = next;
        }
      }
    }
  }

  private addOutOfBoundsSlot(slot: number): void {
    const idx = this.outOfBoundsCount++;
    this.outOfBoundsSlots[idx] = slot;
    this.slotOobIndex[slot] = idx;
  }

  private removeOutOfBoundsSlot(slot: number): void {
    const idx = this.slotOobIndex[slot];
    if (idx === -1) return;
    const lastIdx = --this.outOfBoundsCount;
    if (idx !== lastIdx) {
      const movedSlot = this.outOfBoundsSlots[lastIdx];
      this.outOfBoundsSlots[idx] = movedSlot;
      this.slotOobIndex[movedSlot] = idx;
    }
    this.slotOobIndex[slot] = -1;
  }
}
