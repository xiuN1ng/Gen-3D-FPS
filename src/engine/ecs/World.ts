import {
  COMP_UID,
  ComponentStorage,
  type ComponentDef,
  type ComponentSchema,
  type InternalComponentDef,
  type SoAColumns,
} from './ComponentStore';
import {
  DEFAULT_MAX_ENTITIES,
  ENTITY_INDEX_MASK,
  MAX_COMPONENTS,
  MAX_SUPPORTED_ENTITIES,
  NULL_ENTITY,
  nextGeneration,
  packEntityId,
  type EntityId,
} from './EntityId';
import {
  EVENT_UID,
  EventRingBuffer,
  type EventDef,
  type InternalEventDef,
} from './EventRingBuffer';
import { Query, type QueryFilter } from './Query';
import { SparseSet } from './SparseSet';

export interface WorldOptions {
  maxEntities?: number;
}

export class World {
  readonly maxEntities: number;

  private readonly _slotEntityId: Uint32Array;
  private readonly _generations: Uint32Array;
  private readonly _freeRing: Uint16Array;
  private _freeHead = 0;
  private _freeTail = 0;
  private _aliveCount = 0;

  private readonly _deferred: SparseSet;

  private readonly _maskLo: Uint32Array;
  private readonly _maskHi: Uint32Array;

  private _compIdByUid = new Int16Array(64).fill(-1);
  private readonly _compIdFallback = new Map<ComponentDef<any>, number>();
  private readonly _stores: ComponentStorage<any>[] = [];
  private _componentCount = 0;

  private readonly _queries: Query[] = [];
  private readonly _queryCache = new Map<string, Query>();
  private readonly _queriesByComp: Query[][];
  private readonly _emptyMatchingQueries: Query[] = [];

  private _eventBufByUid: (EventRingBuffer<any> | undefined)[] = [];
  private readonly _eventBufFallback = new Map<EventDef<any>, EventRingBuffer<any>>();
  private readonly _eventBuffers: EventRingBuffer<any>[] = [];

  constructor(options?: WorldOptions) {
    const maxEntities = options?.maxEntities ?? DEFAULT_MAX_ENTITIES;
    if (
      !Number.isInteger(maxEntities) ||
      maxEntities < 1 ||
      maxEntities > MAX_SUPPORTED_ENTITIES
    ) {
      throw new RangeError(
        `World maxEntities must be an integer in [1, ${MAX_SUPPORTED_ENTITIES}], got ${maxEntities}`,
      );
    }

    this.maxEntities = maxEntities;
    this._slotEntityId = new Uint32Array(maxEntities);
    this._generations = new Uint32Array(maxEntities);
    this._freeRing = new Uint16Array(maxEntities);

    for (let i = 0; i < maxEntities; i++) {
      this._generations[i] = 1;
      this._freeRing[i] = i;
    }

    this._deferred = new SparseSet(maxEntities);
    this._maskLo = new Uint32Array(maxEntities);
    this._maskHi = new Uint32Array(maxEntities);

    const byComp: Query[][] = new Array<Query[]>(MAX_COMPONENTS);
    for (let i = 0; i < MAX_COMPONENTS; i++) {
      byComp[i] = [];
    }
    this._queriesByComp = byComp;
  }

  get aliveCount(): number {
    return this._aliveCount;
  }

  get deferredDestroyCount(): number {
    return this._deferred.count;
  }

  createEntity(): EntityId {
    if (this._aliveCount === this.maxEntities) {
      return NULL_ENTITY;
    }

    const head = this._freeHead;
    const slot = this._freeRing[head];
    this._freeHead = head + 1 === this.maxEntities ? 0 : head + 1;
    this._aliveCount++;

    const id = packEntityId(slot, this._generations[slot]);
    this._slotEntityId[slot] = id;

    const emptyQueries = this._emptyMatchingQueries;
    for (let i = 0, n = emptyQueries.length; i < n; i++) {
      emptyQueries[i]._insert(slot, id);
    }

    return id;
  }

  createEntityStrict(): EntityId {
    const id = this.createEntity();
    if (id === NULL_ENTITY) {
      throw new RangeError(`World entity capacity (${this.maxEntities}) exhausted`);
    }
    return id;
  }

  destroyEntity(id: EntityId): boolean {
    const slot = this.slotOf(id);
    if (slot === -1) {
      return false;
    }

    if (this._deferred.count > 0) {
      this._deferred.remove(slot);
    }

    let lo = this._maskLo[slot];
    let hi = this._maskHi[slot];
    const stores = this._stores;

    if (lo !== 0) {
      while (lo !== 0) {
        const lsb = lo & -lo;
        const compId = 31 - Math.clz32(lsb);
        stores[compId].resetSlot(slot);
        lo &= lo - 1;
      }
      this._maskLo[slot] = 0;
    }

    if (hi !== 0) {
      while (hi !== 0) {
        const lsb = hi & -hi;
        const compId = 32 + (31 - Math.clz32(lsb));
        stores[compId].resetSlot(slot);
        hi &= hi - 1;
      }
      this._maskHi[slot] = 0;
    }

    const queries = this._queries;
    for (let i = 0, n = queries.length; i < n; i++) {
      queries[i]._remove(slot);
    }

    this._slotEntityId[slot] = NULL_ENTITY;
    this._generations[slot] = nextGeneration(this._generations[slot]);

    const tail = this._freeTail;
    this._freeRing[tail] = slot;
    this._freeTail = tail + 1 === this.maxEntities ? 0 : tail + 1;
    this._aliveCount--;

    return true;
  }

  deferDestroy(id: EntityId): boolean {
    const slot = this.slotOf(id);
    if (slot === -1) {
      return false;
    }
    return this._deferred.insert(slot, id);
  }

  flushDeferred(): number {
    const n = this._deferred.count;
    if (n === 0) {
      return 0;
    }
    const entities = this._deferred.entities;
    this._deferred.clear();
    let destroyed = 0;
    for (let i = 0; i < n; i++) {
      if (this.destroyEntity(entities[i])) {
        destroyed++;
      }
    }
    return destroyed;
  }

  isAlive(id: EntityId): boolean {
    if (id <= 0 || (id | 0) !== id) {
      return false;
    }
    const slot = id & ENTITY_INDEX_MASK;
    return slot < this.maxEntities && this._slotEntityId[slot] === id;
  }

  slotOf(id: EntityId): number {
    if (id <= 0 || (id | 0) !== id) {
      return -1;
    }
    const slot = id & ENTITY_INDEX_MASK;
    return slot < this.maxEntities && this._slotEntityId[slot] === id ? slot : -1;
  }

  entityAtSlot(slot: number): EntityId {
    if (slot < 0 || slot >= this.maxEntities || (slot | 0) !== slot) {
      return NULL_ENTITY;
    }
    return this._slotEntityId[slot];
  }

  registerComponent<S extends ComponentSchema>(def: ComponentDef<S>): number {
    const existing = this._lookupComponentId(def);
    if (existing !== -1) {
      return existing;
    }

    if (this._componentCount >= MAX_COMPONENTS) {
      throw new RangeError(
        `World exceeded maximum component count (${MAX_COMPONENTS}) while registering "${def.name}"`,
      );
    }

    const compId = this._componentCount++;
    const uid = (def as InternalComponentDef<S>)[COMP_UID];
    if (uid !== undefined) {
      this._ensureCompUidCapacity(uid);
      this._compIdByUid[uid] = compId;
    } else {
      this._compIdFallback.set(def, compId);
    }

    this._stores.push(new ComponentStorage(def, this.maxEntities));
    return compId;
  }

  addComponent<S extends ComponentSchema>(
    id: EntityId,
    def: ComponentDef<S>,
    init?: Partial<Record<keyof S, number>>,
  ): number {
    const compId = this.registerComponent(def);
    const slot = this.slotOf(id);
    if (slot === -1) {
      return -1;
    }

    const store = this._stores[compId] as ComponentStorage<S>;
    let mLo = this._maskLo[slot];
    let mHi = this._maskHi[slot];

    if (compId < 32) {
      const bit = 1 << compId;
      if ((mLo & bit) !== 0) {
        store.patchSlot(slot, init);
        return slot;
      }
      store.initSlot(slot, init);
      mLo = (mLo | bit) >>> 0;
      this._maskLo[slot] = mLo;
    } else {
      const bit = 1 << (compId - 32);
      if ((mHi & bit) !== 0) {
        store.patchSlot(slot, init);
        return slot;
      }
      store.initSlot(slot, init);
      mHi = (mHi | bit) >>> 0;
      this._maskHi[slot] = mHi;
    }

    const affected = this._queriesByComp[compId];
    for (let i = 0, n = affected.length; i < n; i++) {
      affected[i]._sync(slot, id, mLo, mHi);
    }

    return slot;
  }

  removeComponent<S extends ComponentSchema>(id: EntityId, def: ComponentDef<S>): boolean {
    const slot = this.slotOf(id);
    if (slot === -1) {
      return false;
    }
    const compId = this._lookupComponentId(def);
    if (compId === -1) {
      return false;
    }

    let mLo = this._maskLo[slot];
    let mHi = this._maskHi[slot];

    if (compId < 32) {
      const bit = 1 << compId;
      if ((mLo & bit) === 0) {
        return false;
      }
      mLo = (mLo & ~bit) >>> 0;
      this._maskLo[slot] = mLo;
    } else {
      const bit = 1 << (compId - 32);
      if ((mHi & bit) === 0) {
        return false;
      }
      mHi = (mHi & ~bit) >>> 0;
      this._maskHi[slot] = mHi;
    }

    this._stores[compId].resetSlot(slot);

    const affected = this._queriesByComp[compId];
    for (let i = 0, n = affected.length; i < n; i++) {
      affected[i]._sync(slot, id, mLo, mHi);
    }

    return true;
  }

  hasComponent<S extends ComponentSchema>(id: EntityId, def: ComponentDef<S>): boolean {
    const slot = this.slotOf(id);
    if (slot === -1) {
      return false;
    }
    const compId = this._lookupComponentId(def);
    if (compId === -1) {
      return false;
    }
    if (compId < 32) {
      return (this._maskLo[slot] & (1 << compId)) !== 0;
    }
    return (this._maskHi[slot] & (1 << (compId - 32))) !== 0;
  }

  getStore<S extends ComponentSchema>(def: ComponentDef<S>): SoAColumns<S> {
    const compId = this.registerComponent(def);
    return (this._stores[compId] as ComponentStorage<S>).columns;
  }

  query(filter: QueryFilter): Query {
    let allLo = 0;
    let allHi = 0;
    let noneLo = 0;
    let noneHi = 0;
    let anyLo = 0;
    let anyHi = 0;

    if (filter.all !== undefined) {
      for (let i = 0; i < filter.all.length; i++) {
        const cid = this.registerComponent(filter.all[i]);
        if (cid < 32) allLo |= 1 << cid;
        else allHi |= 1 << (cid - 32);
      }
    }
    if (filter.with !== undefined) {
      for (let i = 0; i < filter.with.length; i++) {
        const cid = this.registerComponent(filter.with[i]);
        if (cid < 32) allLo |= 1 << cid;
        else allHi |= 1 << (cid - 32);
      }
    }
    if (filter.none !== undefined) {
      for (let i = 0; i < filter.none.length; i++) {
        const cid = this.registerComponent(filter.none[i]);
        if (cid < 32) noneLo |= 1 << cid;
        else noneHi |= 1 << (cid - 32);
      }
    }
    if (filter.without !== undefined) {
      for (let i = 0; i < filter.without.length; i++) {
        const cid = this.registerComponent(filter.without[i]);
        if (cid < 32) noneLo |= 1 << cid;
        else noneHi |= 1 << (cid - 32);
      }
    }
    if (filter.any !== undefined) {
      for (let i = 0; i < filter.any.length; i++) {
        const cid = this.registerComponent(filter.any[i]);
        if (cid < 32) anyLo |= 1 << cid;
        else anyHi |= 1 << (cid - 32);
      }
    }

    const key =
      `${(allLo >>> 0).toString(16)}:${(allHi >>> 0).toString(16)}:` +
      `${(noneLo >>> 0).toString(16)}:${(noneHi >>> 0).toString(16)}:` +
      `${(anyLo >>> 0).toString(16)}:${(anyHi >>> 0).toString(16)}`;

    const existing = this._queryCache.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const q = new Query(key, this.maxEntities, allLo, allHi, noneLo, noneHi, anyLo, anyHi);
    this._queryCache.set(key, q);
    this._queries.push(q);

    if (!q._impossible) {
      let relevantLo = (allLo | noneLo | anyLo) | 0;
      while (relevantLo !== 0) {
        const lsb = relevantLo & -relevantLo;
        const cid = 31 - Math.clz32(lsb);
        this._queriesByComp[cid].push(q);
        relevantLo &= relevantLo - 1;
      }

      let relevantHi = (allHi | noneHi | anyHi) | 0;
      while (relevantHi !== 0) {
        const lsb = relevantHi & -relevantHi;
        const cid = 32 + (31 - Math.clz32(lsb));
        this._queriesByComp[cid].push(q);
        relevantHi &= relevantHi - 1;
      }

      if (q._matchesEmpty) {
        this._emptyMatchingQueries.push(q);
      }

      if (this._aliveCount > 0) {
        for (let slot = 0; slot < this.maxEntities; slot++) {
          const entityId = this._slotEntityId[slot];
          if (entityId !== NULL_ENTITY && q._matches(this._maskLo[slot], this._maskHi[slot])) {
            q._insert(slot, entityId);
          }
        }
      }
    }

    return q;
  }

  events<S extends ComponentSchema>(def: EventDef<S>): EventRingBuffer<S> {
    const uid = (def as InternalEventDef<S>)[EVENT_UID];
    if (uid !== undefined) {
      const existing = this._eventBufByUid[uid];
      if (existing !== undefined) {
        return existing as EventRingBuffer<S>;
      }
      const created = new EventRingBuffer(def);
      this._eventBufByUid[uid] = created;
      this._eventBuffers.push(created);
      return created;
    }

    const existingFallback = this._eventBufFallback.get(def);
    if (existingFallback !== undefined) {
      return existingFallback as EventRingBuffer<S>;
    }
    const createdFallback = new EventRingBuffer(def);
    this._eventBufFallback.set(def, createdFallback);
    this._eventBuffers.push(createdFallback);
    return createdFallback;
  }

  clearEvents(): void {
    const buffers = this._eventBuffers;
    for (let i = 0, n = buffers.length; i < n; i++) {
      buffers[i].clear();
    }
  }

  reset(): void {
    for (let slot = 0; slot < this.maxEntities; slot++) {
      if (this._slotEntityId[slot] !== NULL_ENTITY) {
        this._generations[slot] = nextGeneration(this._generations[slot]);
        this._slotEntityId[slot] = NULL_ENTITY;
      }
      this._freeRing[slot] = slot;
    }
    this._freeHead = 0;
    this._freeTail = 0;
    this._aliveCount = 0;

    this._deferred.clear();
    this._maskLo.fill(0);
    this._maskHi.fill(0);

    for (let i = 0; i < this._stores.length; i++) {
      this._stores[i].resetAll();
    }

    for (let i = 0; i < this._queries.length; i++) {
      this._queries[i]._clear();
    }

    for (let i = 0; i < this._eventBuffers.length; i++) {
      this._eventBuffers[i].clear();
      this._eventBuffers[i].resetStats();
    }
  }

  private _lookupComponentId(def: ComponentDef<any>): number {
    const uid = (def as InternalComponentDef<any>)[COMP_UID];
    if (uid !== undefined) {
      return uid < this._compIdByUid.length ? this._compIdByUid[uid] : -1;
    }
    return this._compIdFallback.get(def) ?? -1;
  }

  private _ensureCompUidCapacity(uid: number): void {
    if (uid < this._compIdByUid.length) {
      return;
    }
    let nextCap = this._compIdByUid.length;
    while (nextCap <= uid) {
      nextCap *= 2;
    }
    const grown = new Int16Array(nextCap).fill(-1);
    grown.set(this._compIdByUid);
    this._compIdByUid = grown;
  }
}
