import type { ComponentDef } from './ComponentStore';
import type { EntityId } from './EntityId';
import { SparseSet } from './SparseSet';

export interface QueryFilter {
  readonly all?: readonly ComponentDef<any>[];
  readonly with?: readonly ComponentDef<any>[];
  readonly none?: readonly ComponentDef<any>[];
  readonly without?: readonly ComponentDef<any>[];
  readonly any?: readonly ComponentDef<any>[];
}

export class Query {
  readonly key: string;
  readonly dense: Uint16Array;
  readonly entities: Uint32Array;

  /** @internal */
  readonly _allLo: number;
  /** @internal */
  readonly _allHi: number;
  /** @internal */
  readonly _noneLo: number;
  /** @internal */
  readonly _noneHi: number;
  /** @internal */
  readonly _anyLo: number;
  /** @internal */
  readonly _anyHi: number;
  /** @internal */
  readonly _hasAny: boolean;
  /** @internal */
  readonly _impossible: boolean;
  /** @internal */
  readonly _matchesEmpty: boolean;

  private readonly _set: SparseSet;

  constructor(
    key: string,
    capacity: number,
    allLo: number,
    allHi: number,
    noneLo: number,
    noneHi: number,
    anyLo: number,
    anyHi: number,
  ) {
    this.key = key;
    this._set = new SparseSet(capacity);
    this.dense = this._set.dense;
    this.entities = this._set.entities;

    this._allLo = allLo | 0;
    this._allHi = allHi | 0;
    this._noneLo = noneLo | 0;
    this._noneHi = noneHi | 0;
    this._anyLo = anyLo | 0;
    this._anyHi = anyHi | 0;
    this._hasAny = (this._anyLo | this._anyHi) !== 0;

    const allNoneOverlap = ((this._allLo & this._noneLo) | (this._allHi & this._noneHi)) !== 0;
    const anyCompletelyExcluded =
      this._hasAny && ((this._anyLo & ~this._noneLo) | (this._anyHi & ~this._noneHi)) === 0;

    this._impossible = allNoneOverlap || anyCompletelyExcluded;
    this._matchesEmpty =
      !this._impossible && (this._allLo | this._allHi) === 0 && !this._hasAny;
  }

  get count(): number {
    return this._set.count;
  }

  hasSlot(slot: number): boolean {
    return this._set.has(slot);
  }

  forEach(fn: (slot: number, entityId: EntityId, denseIndex: number) => void): void {
    const dense = this.dense;
    const entities = this.entities;
    for (let i = 0; i < this._set.count; i++) {
      fn(dense[i], entities[i], i);
    }
  }

  /** @internal */
  _matches(mLo: number, mHi: number): boolean {
    if (this._impossible) {
      return false;
    }
    if (
      ((~mLo & this._allLo) |
        (~mHi & this._allHi) |
        (mLo & this._noneLo) |
        (mHi & this._noneHi)) !==
      0
    ) {
      return false;
    }
    return !this._hasAny || ((mLo & this._anyLo) | (mHi & this._anyHi)) !== 0;
  }

  /** @internal */
  _sync(slot: number, entityId: EntityId, mLo: number, mHi: number): void {
    if (this._matches(mLo, mHi)) {
      this._set.insert(slot, entityId);
    } else {
      this._set.remove(slot);
    }
  }

  /** @internal */
  _insert(slot: number, entityId: EntityId): void {
    this._set.insert(slot, entityId);
  }

  /** @internal */
  _remove(slot: number): void {
    this._set.remove(slot);
  }

  /** @internal */
  _clear(): void {
    this._set.clear();
  }
}
