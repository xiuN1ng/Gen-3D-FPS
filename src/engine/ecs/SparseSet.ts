import { DEFAULT_MAX_ENTITIES, type EntityId } from './EntityId';

const MAX_SPARSE_SET_CAPACITY = 65536;

export class SparseSet {
  readonly capacity: number;
  readonly dense: Uint16Array;
  readonly entities: Uint32Array;
  readonly sparse: Uint16Array;
  private _count = 0;

  constructor(capacity: number = DEFAULT_MAX_ENTITIES) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SPARSE_SET_CAPACITY) {
      throw new RangeError(
        `SparseSet capacity must be an integer in [1, ${MAX_SPARSE_SET_CAPACITY}], got ${capacity}`,
      );
    }
    this.capacity = capacity;
    this.dense = new Uint16Array(capacity);
    this.entities = new Uint32Array(capacity);
    this.sparse = new Uint16Array(capacity);
  }

  get count(): number {
    return this._count;
  }

  has(slot: number): boolean {
    if (slot < 0 || slot >= this.capacity || (slot | 0) !== slot) {
      return false;
    }
    const idx = this.sparse[slot];
    return idx < this._count && this.dense[idx] === slot;
  }

  insert(slot: number, entityId: EntityId): boolean {
    if (slot < 0 || slot >= this.capacity || (slot | 0) !== slot) {
      return false;
    }
    const existingIdx = this.sparse[slot];
    if (existingIdx < this._count && this.dense[existingIdx] === slot) {
      return false;
    }
    const idx = this._count;
    this.dense[idx] = slot;
    this.entities[idx] = entityId;
    this.sparse[slot] = idx;
    this._count = idx + 1;
    return true;
  }

  updateEntityId(slot: number, entityId: EntityId): void {
    if (slot < 0 || slot >= this.capacity || (slot | 0) !== slot) {
      return;
    }
    const idx = this.sparse[slot];
    if (idx < this._count && this.dense[idx] === slot) {
      this.entities[idx] = entityId;
    }
  }

  remove(slot: number): boolean {
    if (slot < 0 || slot >= this.capacity || (slot | 0) !== slot) {
      return false;
    }
    const idx = this.sparse[slot];
    const count = this._count;
    if (idx >= count || this.dense[idx] !== slot) {
      return false;
    }
    const lastIdx = count - 1;
    if (idx !== lastIdx) {
      const movedSlot = this.dense[lastIdx];
      this.dense[idx] = movedSlot;
      this.entities[idx] = this.entities[lastIdx];
      this.sparse[movedSlot] = idx;
    }
    this._count = lastIdx;
    return true;
  }

  clear(): void {
    this._count = 0;
  }
}
