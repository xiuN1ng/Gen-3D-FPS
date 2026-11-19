import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MAX_ENTITIES,
  ENTITY_GEN_BITS,
  ENTITY_GEN_MASK,
  ENTITY_INDEX_BITS,
  ENTITY_INDEX_MASK,
  EventRingBuffer,
  MAX_COMPONENTS,
  MAX_SUPPORTED_ENTITIES,
  NULL_ENTITY,
  SYSTEM_PHASES,
  SparseSet,
  SystemPipeline,
  World,
  defineComponent,
  defineEvent,
  defineTag,
  entityGeneration,
  entityIndex,
  nextGeneration,
  packEntityId,
  type ComponentDef,
  type EntityId,
  type Query,
} from '../index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('F5 — Generational EntityId & World Lifecycle', () => {
  it('packs and unpacks 31-bit V8 Smi EntityIds and wraps generation 0x7ffff -> 1', () => {
    assert.equal(NULL_ENTITY, 0);
    assert.equal(ENTITY_INDEX_BITS, 12);
    assert.equal(ENTITY_INDEX_MASK, 0xfff);
    assert.equal(ENTITY_GEN_BITS, 19);
    assert.equal(ENTITY_GEN_MASK, 0x7ffff);
    assert.equal(DEFAULT_MAX_ENTITIES, 2048);
    assert.equal(MAX_SUPPORTED_ENTITIES, 4096);
    assert.equal(MAX_COMPONENTS, 64);

    const minValid = packEntityId(0, 1);
    assert.ok(minValid > 0 && minValid <= 0x7fffffff);
    assert.equal(entityIndex(minValid), 0);
    assert.equal(entityGeneration(minValid), 1);

    const maxValid = packEntityId(0xfff, 0x7ffff);
    assert.equal(maxValid, 0x7fffffff);
    assert.ok(Number.isSafeInteger(maxValid) && maxValid > 0 && maxValid <= 0x7fffffff);
    assert.equal(entityIndex(maxValid), 4095);
    assert.equal(entityGeneration(maxValid), 0x7ffff);

    assert.equal(nextGeneration(0), 1);
    assert.equal(nextGeneration(1), 2);
    assert.equal(nextGeneration(0x7fffe), 0x7ffff);
    assert.equal(nextGeneration(0x7ffff), 1);
  });

  it('maintains 31-bit Smi bounds, FIFO cooldown ring, and ABA safety across 100,000+ cycles', () => {
    const world = new World();
    assert.equal(world.maxEntities, DEFAULT_MAX_ENTITIES);
    assert.equal(world.aliveCount, 0);

    let prevStale: EntityId = NULL_ENTITY;
    for (let i = 0; i < 120_000; i++) {
      const id = world.createEntity();
      assert.ok(id > 0 && id <= 0x7fffffff && (id | 0) === id);
      const expectedSlot = i % DEFAULT_MAX_ENTITIES;
      const expectedGen = Math.floor(i / DEFAULT_MAX_ENTITIES) + 1;
      assert.equal(entityIndex(id), expectedSlot);
      assert.equal(entityGeneration(id), expectedGen);
      assert.equal(world.isAlive(id), true);
      assert.equal(world.slotOf(id), expectedSlot);
      assert.equal(world.entityAtSlot(expectedSlot), id);

      if (prevStale !== NULL_ENTITY) {
        assert.equal(world.isAlive(prevStale), false);
        assert.equal(world.slotOf(prevStale), -1);
        assert.equal(world.destroyEntity(prevStale), false);
      }

      assert.equal(world.destroyEntity(id), true);
      assert.equal(world.isAlive(id), false);
      assert.equal(world.entityAtSlot(expectedSlot), NULL_ENTITY);
      prevStale = id;
    }
    assert.equal(world.aliveCount, 0);
  });

  it('wraps slot generation 0x7ffff -> 1 skipping 0 in live World spawn/destroy cycles', () => {
    const world = new World({ maxEntities: 1 });
    const totalCycles = ENTITY_GEN_MASK + 4; // 524,291 cycles -> crosses 0x7ffff -> 1
    let sawMaxGen = false;
    let sawWrappedGenOne = false;

    for (let i = 0; i < totalCycles; i++) {
      const id = world.createEntity();
      assert.ok(id > 0 && id <= 0x7fffffff);
      const gen = entityGeneration(id);
      assert.notEqual(gen, 0);
      if (gen === ENTITY_GEN_MASK) {
        sawMaxGen = true;
      } else if (sawMaxGen && gen === 1) {
        sawWrappedGenOne = true;
      }
      assert.equal(world.destroyEntity(id), true);
    }

    assert.equal(sawMaxGen, true);
    assert.equal(sawWrappedGenOne, true);
  });

  it('validates WorldOptions bounds, capacity exhaustion, invalid handles, and reset()', () => {
    assert.throws(() => new World({ maxEntities: 0 }), RangeError);
    assert.throws(() => new World({ maxEntities: -5 }), RangeError);
    assert.throws(() => new World({ maxEntities: 4097 }), RangeError);
    assert.throws(() => new World({ maxEntities: 12.5 }), RangeError);
    assert.throws(() => new World({ maxEntities: Number.NaN }), RangeError);

    const world = new World({ maxEntities: 4 });
    const ids: EntityId[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(world.createEntityStrict());
    }
    assert.equal(world.aliveCount, 4);
    assert.equal(world.createEntity(), NULL_ENTITY);
    assert.throws(() => world.createEntityStrict(), RangeError);

    // Reject negative, NaN, non-integer, and out-of-range handles/slots
    assert.equal(world.isAlive(NULL_ENTITY), false);
    assert.equal(world.isAlive(-1), false);
    assert.equal(world.isAlive(Number.NaN), false);
    assert.equal(world.isAlive(ids[0] + 0.5), false);
    assert.equal(world.slotOf(-1), -1);
    assert.equal(world.entityAtSlot(-1), NULL_ENTITY);
    assert.equal(world.entityAtSlot(4), NULL_ENTITY);
    assert.equal(world.entityAtSlot(1.5), NULL_ENTITY);

    assert.equal(world.deferDestroy(ids[1]), true);
    assert.equal(world.deferredDestroyCount, 1);

    world.reset();
    assert.equal(world.aliveCount, 0);
    assert.equal(world.deferredDestroyCount, 0);
    for (const stale of ids) {
      assert.equal(world.isAlive(stale), false);
    }

    const fresh = world.createEntityStrict();
    assert.equal(entityIndex(fresh), 0);
    assert.notEqual(fresh, ids[0]); // ABA safe across reset()
    assert.equal(world.isAlive(ids[0]), false);

    // Out-of-order destroy recycles in exact FIFO destruction order after untouched slots
    const fifoWorld = new World({ maxEntities: 6 });
    const batch = [
      fifoWorld.createEntityStrict(), // slot 0
      fifoWorld.createEntityStrict(), // slot 1
      fifoWorld.createEntityStrict(), // slot 2
      fifoWorld.createEntityStrict(), // slot 3
    ];
    // Destroy in order: slot 2, slot 0, slot 3 (slots 4 and 5 are still untouched ahead of them)
    assert.equal(fifoWorld.destroyEntity(batch[2]), true);
    assert.equal(fifoWorld.destroyEntity(batch[0]), true);
    assert.equal(fifoWorld.destroyEntity(batch[3]), true);

    const nextSlots = [
      entityIndex(fifoWorld.createEntityStrict()),
      entityIndex(fifoWorld.createEntityStrict()),
      entityIndex(fifoWorld.createEntityStrict()),
      entityIndex(fifoWorld.createEntityStrict()),
      entityIndex(fifoWorld.createEntityStrict()),
    ];
    assert.deepEqual(nextSlots, [4, 5, 2, 0, 3]);
  });
});

describe('SparseSet Direct Contract', () => {
  it('supports O(1) insert, duplicate rejection, updateEntityId, swap-remove, and clear', () => {
    assert.throws(() => new SparseSet(0), RangeError);
    assert.throws(() => new SparseSet(70000), RangeError);

    const set = new SparseSet(16);
    assert.equal(set.capacity, 16);
    assert.equal(set.count, 0);

    assert.equal(set.insert(3, 1003), true);
    assert.equal(set.insert(7, 1007), true);
    assert.equal(set.insert(11, 1011), true);
    assert.equal(set.insert(7, 9999), false); // Duplicate rejected
    assert.equal(set.insert(-1, 100), false);
    assert.equal(set.insert(16, 100), false);

    assert.equal(set.count, 3);
    assert.equal(set.has(3), true);
    assert.equal(set.has(7), true);
    assert.equal(set.has(11), true);
    assert.equal(set.has(0), false);
    assert.equal(set.entities[1], 1007);

    set.updateEntityId(7, 2007);
    assert.equal(set.entities[1], 2007);

    // Swap-remove first element (slot 3 swapped with slot 11)
    assert.equal(set.remove(3), true);
    assert.equal(set.remove(3), false);
    assert.equal(set.count, 2);
    assert.equal(set.has(3), false);
    assert.equal(set.dense[0], 11);
    assert.equal(set.entities[0], 1011);
    assert.equal(set.dense[1], 7);
    assert.equal(set.entities[1], 2007);

    set.clear();
    assert.equal(set.count, 0);
    assert.equal(set.has(7), false);
    assert.equal(set.has(11), false);
  });
});

describe('F6 — Strongly-Typed TypedArray SoA Component Storage & Multi-World Isolation', () => {
  it('supports all 8 FieldTypes, defaults, defineTag zero-column stores, partial re-add, and slot reset', () => {
    const AllTypes = defineComponent(
      'AllTypes',
      {
        aF32: 'f32',
        bF64: 'f64',
        cI32: 'i32',
        dU32: 'u32',
        eI16: 'i16',
        fU16: 'u16',
        gI8: 'i8',
        hU8: 'u8',
      },
      {
        aF32: 1.5,
        bF64: 2.25,
        cI32: -100_000,
        dU32: 3_000_000_000,
        eI16: -1234,
        fU16: 50000,
      },
    );
    const BossTag = defineTag('BossTag');
    const EmptyComp = defineComponent('EmptyComp', {});

    assert.equal(AllTypes.isTag, false);
    assert.equal(BossTag.isTag, true);
    assert.equal(EmptyComp.isTag, true);

    const world = new World({ maxEntities: 8 });
    const store = world.getStore(AllTypes);
    const tagStore = world.getStore(BossTag);

    assert.ok(store.aF32 instanceof Float32Array);
    assert.ok(store.bF64 instanceof Float64Array);
    assert.ok(store.cI32 instanceof Int32Array);
    assert.ok(store.dU32 instanceof Uint32Array);
    assert.ok(store.eI16 instanceof Int16Array);
    assert.ok(store.fU16 instanceof Uint16Array);
    assert.ok(store.gI8 instanceof Int8Array);
    assert.ok(store.hU8 instanceof Uint8Array);
    assert.equal(Object.keys(tagStore).length, 0);

    const e = world.createEntityStrict();
    const slot = world.addComponent(e, AllTypes, { gI8: -42, hU8: 250 });
    assert.equal(slot, 0);
    assert.equal(world.hasComponent(e, AllTypes), true);
    assert.equal(store.aF32[slot], 1.5);
    assert.equal(store.bF64[slot], 2.25);
    assert.equal(store.cI32[slot], -100_000);
    assert.equal(store.dU32[slot], 3_000_000_000);
    assert.equal(store.eI16[slot], -1234);
    assert.equal(store.fU16[slot], 50000);
    assert.equal(store.gI8[slot], -42);
    assert.equal(store.hU8[slot], 250);

    // Re-adding existing component with partial init updates only specified fields
    const q = world.query({ all: [AllTypes] });
    assert.equal(q.count, 1);
    const slotAgain = world.addComponent(e, AllTypes, { aF32: 9.5 });
    assert.equal(slotAgain, slot);
    assert.equal(q.count, 1);
    assert.equal(store.aF32[slot], 9.5);
    assert.equal(store.gI8[slot], -42); // Unclobbered
    assert.equal(store.hU8[slot], 250); // Unclobbered

    // Tag component lifecycle
    assert.equal(world.addComponent(e, BossTag), slot);
    assert.equal(world.hasComponent(e, BossTag), true);
    assert.equal(world.removeComponent(e, BossTag), true);
    assert.equal(world.hasComponent(e, BossTag), false);
    assert.equal(world.removeComponent(e, BossTag), false);

    // removeComponent resets slot values to defaults / 0
    assert.equal(world.removeComponent(e, AllTypes), true);
    assert.equal(world.hasComponent(e, AllTypes), false);
    assert.equal(store.aF32[slot], 1.5);
    assert.equal(store.gI8[slot], 0);
    assert.equal(store.hU8[slot], 0);

    // destroyEntity resets attached component slots to defaults / 0 and dead entity returns -1
    world.addComponent(e, AllTypes, { aF32: 77, gI8: 99, hU8: 200 });
    assert.equal(world.destroyEntity(e), true);
    assert.equal(store.aF32[slot], 1.5);
    assert.equal(store.gI8[slot], 0);
    assert.equal(store.hU8[slot], 0);
    assert.equal(world.addComponent(e, AllTypes, { aF32: 5 }), -1);
  });

  it('isolates 64-component registries per World and throws RangeError on 65th component', () => {
    const worldA = new World({ maxEntities: 16 });
    const worldB = new World({ maxEntities: 16 });

    const compsA = Array.from({ length: MAX_COMPONENTS }, (_, i) =>
      defineComponent(`CompA_${i}`, { v: 'f32' }, { v: i }),
    );
    const compsB = Array.from({ length: MAX_COMPONENTS }, (_, i) =>
      defineComponent(`CompB_${i}`, { v: 'i32' }, { v: -i }),
    );

    for (let i = 0; i < MAX_COMPONENTS; i++) {
      assert.equal(worldA.registerComponent(compsA[i]), i);
      assert.equal(worldB.registerComponent(compsB[i]), i);
    }

    // Verify sign-bit components #31 (maskLo MSB) and #63 (maskHi MSB) work accurately
    const eA = worldA.createEntityStrict();
    worldA.addComponent(eA, compsA[31], { v: 310 });
    worldA.addComponent(eA, compsA[63], { v: 630 });
    assert.equal(worldA.hasComponent(eA, compsA[31]), true);
    assert.equal(worldA.hasComponent(eA, compsA[63]), true);
    const qSignBits = worldA.query({ all: [compsA[31], compsA[63]], none: [compsA[0]] });
    assert.equal(qSignBits.count, 1);
    assert.equal(qSignBits.entities[0], eA);

    // 65th component on worldA throws RangeError, while worldB also enforces its own 64 limit
    const extraComp = defineTag('Comp_65');
    assert.throws(() => worldA.registerComponent(extraComp), RangeError);
    assert.throws(() => worldB.registerComponent(extraComp), RangeError);

    // A fresh World C can still register extraComp as component 0
    const worldC = new World({ maxEntities: 8 });
    assert.equal(worldC.registerComponent(extraComp), 0);
  });
});

describe('F7 — 64-Bit Bitmask & SparseSet Cached Query Fuzzing + Deferred Destroy', () => {
  it('matches brute-force oracle across 50 components and 6,000 randomized operations', () => {
    const rng = createPrng(0xdecafbad);
    const world = new World({ maxEntities: 256 });

    const comps: ComponentDef<any>[] = Array.from({ length: 50 }, (_, i) =>
      i % 5 === 0
        ? defineTag(`FuzzTag_${i}`)
        : defineComponent(`FuzzComp_${i}`, { val: 'f32' }, { val: i }),
    );
    for (const c of comps) {
      world.registerComponent(c);
    }

    interface OracleQuerySpec {
      readonly query: Query;
      readonly req: ReadonlySet<number>;
      readonly excl: ReadonlySet<number>;
      readonly anySet: ReadonlySet<number>;
    }

    const oracleAlive = new Map<EntityId, Set<number>>();
    const specs: OracleQuerySpec[] = [];

    const makeRandomQuerySpec = (): OracleQuerySpec => {
      const req = new Set<number>();
      const excl = new Set<number>();
      const anySet = new Set<number>();

      const allArr: ComponentDef<any>[] = [];
      const withArr: ComponentDef<any>[] = [];
      const noneArr: ComponentDef<any>[] = [];
      const withoutArr: ComponentDef<any>[] = [];
      const anyArr: ComponentDef<any>[] = [];

      const reqCount = Math.floor(rng() * 4);
      for (let i = 0; i < reqCount; i++) {
        const idx = Math.floor(rng() * 50);
        req.add(idx);
        if (rng() < 0.5) allArr.push(comps[idx]);
        else withArr.push(comps[idx]);
      }

      const exclCount = Math.floor(rng() * 4);
      for (let i = 0; i < exclCount; i++) {
        const idx = Math.floor(rng() * 50);
        excl.add(idx);
        if (rng() < 0.5) noneArr.push(comps[idx]);
        else withoutArr.push(comps[idx]);
      }

      const anyMode = rng();
      let passEmptyAny = false;
      if (anyMode < 0.45) {
        const anyCount = 1 + Math.floor(rng() * 4);
        for (let i = 0; i < anyCount; i++) {
          const idx = Math.floor(rng() * 50);
          anySet.add(idx);
          anyArr.push(comps[idx]);
        }
      } else if (anyMode < 0.65) {
        passEmptyAny = true;
      }

      const query = world.query({
        all: allArr,
        with: withArr,
        none: noneArr,
        without: withoutArr,
        any: passEmptyAny ? [] : anyArr.length > 0 ? anyArr : undefined,
      });

      return { query, req, excl, anySet };
    };

    // Canonical deduplication & explicit corner queries
    const qDedup1 = world.query({
      all: [comps[0], comps[35]],
      none: [comps[12]],
      any: [],
    });
    const qDedup2 = world.query({
      with: [comps[35], comps[0], comps[0]],
      without: [comps[12]],
    });
    assert.equal(qDedup1, qDedup2);

    const qContradict = world.query({ all: [comps[5]], none: [comps[5]] });
    specs.push({
      query: qContradict,
      req: new Set([5]),
      excl: new Set([5]),
      anySet: new Set(),
    });

    const qAllAlive = world.query({});
    specs.push({
      query: qAllAlive,
      req: new Set(),
      excl: new Set(),
      anySet: new Set(),
    });

    for (let i = 0; i < 20; i++) {
      specs.push(makeRandomQuerySpec());
    }

    const verifyAgainstOracle = (): void => {
      assert.equal(world.aliveCount, oracleAlive.size);
      for (const spec of specs) {
        const expected = new Set<EntityId>();
        for (const [id, attached] of oracleAlive) {
          let ok = true;
          for (const r of spec.req) {
            if (!attached.has(r)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          for (const ex of spec.excl) {
            if (attached.has(ex)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          if (spec.anySet.size > 0) {
            let hasOne = false;
            for (const a of spec.anySet) {
              if (attached.has(a)) {
                hasOne = true;
                break;
              }
            }
            if (!hasOne) continue;
          }
          expected.add(id);
        }

        const q = spec.query;
        assert.equal(q.count, expected.size);
        const seen = new Set<EntityId>();
        q.forEach((slot, entityId, denseIdx) => {
          assert.equal(q.dense[denseIdx], slot);
          assert.equal(q.entities[denseIdx], entityId);
          assert.equal(q.hasSlot(slot), true);
          assert.equal(world.slotOf(entityId), slot);
          assert.equal(expected.has(entityId), true);
          seen.add(entityId);
        });
        assert.equal(seen.size, expected.size);
      }
    };

    const aliveList: EntityId[] = [];
    for (let op = 0; op < 6_000; op++) {
      const r = rng();
      if (r < 0.22 || aliveList.length === 0) {
        const id = world.createEntity();
        if (id !== NULL_ENTITY) {
          aliveList.push(id);
          oracleAlive.set(id, new Set());
        }
      } else if (r < 0.34) {
        const idx = Math.floor(rng() * aliveList.length);
        const id = aliveList[idx];
        const last = aliveList[aliveList.length - 1];
        aliveList[idx] = last;
        aliveList.pop();
        assert.equal(world.destroyEntity(id), true);
        oracleAlive.delete(id);
      } else if (r < 0.68) {
        const id = aliveList[Math.floor(rng() * aliveList.length)];
        const cIdx = Math.floor(rng() * 50);
        const comp = comps[cIdx];
        const slot = world.addComponent(id, comp, comp.isTag ? undefined : { val: op });
        assert.equal(slot, world.slotOf(id));
        oracleAlive.get(id)!.add(cIdx);
      } else if (r < 0.96) {
        const id = aliveList[Math.floor(rng() * aliveList.length)];
        const cIdx = Math.floor(rng() * 50);
        const comp = comps[cIdx];
        const had = oracleAlive.get(id)!.delete(cIdx);
        assert.equal(world.removeComponent(id, comp), had);
      } else {
        // Late-registered query populated from existing alive entities
        specs.push(makeRandomQuerySpec());
      }

      if ((op + 1) % 500 === 0) {
        verifyAgainstOracle();
      }
    }

    verifyAgainstOracle();
  });

  it('safely queues deferDestroy during forward query.dense iteration with duplicate protection', () => {
    const HP = defineComponent('HP', { value: 'i32' }, { value: 100 });
    const world = new World({ maxEntities: 64 });
    const q = world.query({ all: [HP] });
    const hpStore = world.getStore(HP);

    const created: EntityId[] = [];
    for (let i = 0; i < 20; i++) {
      const id = world.createEntityStrict();
      world.addComponent(id, HP, { value: i % 2 === 0 ? 0 : 50 });
      created.push(id);
    }

    const visited: EntityId[] = [];
    for (let i = 0; i < q.count; i++) {
      const slot = q.dense[i];
      const id = q.entities[i];
      visited.push(id);
      if (hpStore.value[slot] <= 0) {
        assert.equal(world.deferDestroy(id), true);
        // Duplicate deferDestroy must return false and not double-increment count
        assert.equal(world.deferDestroy(id), false);
      }
    }

    assert.equal(visited.length, 20);
    assert.equal(q.count, 20);
    assert.equal(world.deferredDestroyCount, 10);
    assert.equal(world.deferDestroy(NULL_ENTITY), false);

    // Destroying one deferred entity manually before flushDeferred updates deferredDestroyCount
    assert.equal(world.destroyEntity(created[0]), true);
    assert.equal(world.deferredDestroyCount, 9);

    const flushed = world.flushDeferred();
    assert.equal(flushed, 9);
    assert.equal(world.deferredDestroyCount, 0);
    assert.equal(world.aliveCount, 10);
    assert.equal(q.count, 10);

    for (let i = 0; i < q.count; i++) {
      assert.equal(hpStore.value[q.dense[i]], 50);
    }
  });
});

describe('F8 — Fixed-Capacity Zero-GC EventRingBuffer', () => {
  it('rounds capacity to power-of-two >= 2 and handles overwrite-oldest, slot zeroing, and cursors', () => {
    const TinyEvt = defineEvent('TinyEvt', { a: 'i32', b: 'f32' }, { capacity: 1 });
    assert.equal(TinyEvt.capacity, 2);

    const HitEvt = defineEvent(
      'HitEvt',
      { target: 'u32', damage: 'f32', headshot: 'u8' },
      { capacity: 3, overflow: 'overwrite-oldest' },
    );
    assert.equal(HitEvt.capacity, 4);

    const buf = new EventRingBuffer(HitEvt);
    const cursorFast = buf.createCursor();
    const cursorSlow = buf.createCursor();

    // Push 6 events into capacity-4 overwrite-oldest ring
    for (let i = 1; i <= 6; i++) {
      assert.equal(
        buf.emit({ target: i * 10, damage: i * 5, headshot: i === 1 ? 1 : undefined }),
        true,
      );
      if (i === 2) {
        // Fast cursor reads first 2 events before wrap
        const seenFastEarly: number[] = [];
        const n = buf.readCursor(cursorFast, (slot) => {
          seenFastEarly.push(buf.columns.target[slot]);
        });
        assert.equal(n, 2);
        assert.deepEqual(seenFastEarly, [10, 20]);
      }
    }

    assert.equal(buf.length, 4);
    assert.equal(buf.totalWritten, 6);
    assert.equal(buf.overflowCount, 2);
    assert.equal(buf.droppedCount, 0);

    // Slot 0 was reused for event #5 (target: 50, headshot omitted -> must be zeroed to 0!)
    const slotFor5 = buf.slotAt(2);
    assert.equal(buf.columns.target[slotFor5], 50);
    assert.equal(buf.columns.headshot[slotFor5], 0);
    assert.equal(buf.slotAt(-1), -1);
    assert.equal(buf.slotAt(4), -1);

    // Multi-consumer non-destructive slotAt reads
    const logicalTargets: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      logicalTargets.push(buf.columns.target[buf.slotAt(i)]);
    }
    assert.deepEqual(logicalTargets, [30, 40, 50, 60]);

    // Fast cursor reads [30, 40, 50, 60]
    const seenFastLate: number[] = [];
    buf.readCursor(cursorFast, (slot) => seenFastLate.push(buf.columns.target[slot]));
    assert.deepEqual(seenFastLate, [30, 40, 50, 60]);
    assert.equal(buf.readCursor(cursorFast, () => {}), 0);

    // Slow cursor lagged behind overwrite -> catches up to oldest surviving [30, 40, 50, 60]
    const seenSlow: number[] = [];
    buf.readCursor(cursorSlow, (slot) => seenSlow.push(buf.columns.target[slot]));
    assert.deepEqual(seenSlow, [30, 40, 50, 60]);

    // clear() interaction with existing cursors
    buf.emit({ target: 70, damage: 35 });
    buf.clear();
    assert.equal(buf.length, 0);
    assert.equal(buf.readCursor(cursorFast, () => {}), 0); // 70 was cleared before read

    buf.emit({ target: 80, damage: 40 });
    const afterClear: number[] = [];
    assert.equal(
      buf.readCursor(cursorFast, (slot) => afterClear.push(buf.columns.target[slot])),
      1,
    );
    assert.deepEqual(afterClear, [80]);

    buf.resetStats();
    assert.equal(buf.totalWritten, 0);
    assert.equal(buf.overflowCount, 0);
    assert.equal(buf.droppedCount, 0);
    assert.equal(buf.length, 1);
  });

  it('enforces drop-newest overflow policy cleanly', () => {
    const DropEvt = defineEvent(
      'DropEvt',
      { code: 'i32' },
      { capacity: 4, overflow: 'drop-newest' },
    );
    const world = new World({ maxEntities: 8 });
    const buf = world.events(DropEvt);
    assert.equal(world.events(DropEvt), buf);

    for (let i = 1; i <= 4; i++) {
      assert.equal(buf.emit({ code: i }), true);
    }
    assert.equal(buf.pushSlot(), -1);
    assert.equal(buf.emit({ code: 99 }), false);

    assert.equal(buf.length, 4);
    assert.equal(buf.totalWritten, 4);
    assert.equal(buf.droppedCount, 2);
    assert.equal(buf.overflowCount, 2);

    const codes = [0, 1, 2, 3].map((i) => buf.columns.code[buf.slotAt(i)]);
    assert.deepEqual(codes, [1, 2, 3, 4]);

    world.clearEvents();
    assert.equal(buf.length, 0);
  });
});

describe('F9 — Deterministic SystemPipeline & Timing Probes', () => {
  it('sorts by (phase, priority, registrationOrder), flushes phases, clears events, and records EMA telemetry', () => {
    const world = new World({ maxEntities: 32 });
    const Tag = defineTag('PipeTag');
    const TickEvt = defineEvent('TickEvt', { step: 'u32' });
    const q = world.query({ all: [Tag] });

    let fakeNow = 100;
    const pipeline = new SystemPipeline(world, {
      now: () => fakeNow,
      emaAlpha: 0.25,
    });

    const order: string[] = [];
    let cleanupSawAliveCount = -1;
    let telemetrySawEvents = -1;

    pipeline
      .addSystem({
        name: 'telemetry_last',
        phase: 'telemetry',
        execute(ctx) {
          order.push('telemetry_last');
          telemetrySawEvents = ctx.world.events(TickEvt).length;
          fakeNow += 0.5;
        },
      })
      .addSystem({
        name: 'mobility_p0_first',
        phase: 'mobility',
        priority: 0,
        budgetMs: 2.0,
        execute() {
          order.push('mobility_p0_first');
          fakeNow += 3.0; // Exceeds 2.0ms budget on tick 1
        },
      })
      .addSystem({
        name: 'mobility_p0_second',
        phase: 'mobility',
        priority: 0,
        execute() {
          order.push('mobility_p0_second');
          fakeNow += 1.0;
        },
      })
      .addSystem({
        name: 'mobility_neg5',
        phase: 'mobility',
        priority: -5,
        execute() {
          order.push('mobility_neg5');
          fakeNow += 0.5;
        },
      })
      .addSystem({
        name: 'input_first',
        phase: 'input',
        execute(ctx) {
          order.push('input_first');
          ctx.world.events(TickEvt).emit({ step: ctx.tick });
          fakeNow += 1.0;
        },
      })
      .addSystem({
        name: 'combat_defer',
        phase: 'combat',
        execute(ctx) {
          order.push('combat_defer');
          for (let i = 0; i < q.count; i++) {
            ctx.world.deferDestroy(q.entities[i]);
          }
          fakeNow += 1.0;
        },
      })
      .addSystem({
        name: 'cleanup_verify_flushed',
        phase: 'cleanup',
        execute(ctx) {
          order.push('cleanup_verify_flushed');
          cleanupSawAliveCount = ctx.world.aliveCount;
          fakeNow += 1.0;
        },
      });

    assert.equal(SYSTEM_PHASES.length, 9);
    const e1 = world.createEntityStrict();
    world.addComponent(e1, Tag);

    pipeline.step(1 / 120);

    assert.deepEqual(order, [
      'input_first',
      'mobility_neg5',
      'mobility_p0_first',
      'mobility_p0_second',
      'combat_defer',
      'cleanup_verify_flushed',
      'telemetry_last',
    ]);
    assert.equal(cleanupSawAliveCount, 0); // Flushed right after combat phase!
    assert.equal(telemetrySawEvents, 1); // Event visible during tick
    assert.equal(world.events(TickEvt).length, 0); // Cleared at end of tick!

    const mobRec = pipeline.getSystemTiming('mobility_p0_first')!;
    assert.equal(mobRec.calls, 1);
    assert.equal(mobRec.lastMs, 3.0);
    assert.equal(mobRec.emaMs, 3.0); // Initialized to ms on calls === 1!
    assert.equal(mobRec.maxMs, 3.0);
    assert.equal(mobRec.budgetExceededCount, 1);

    const snap1 = pipeline.getTimings();
    assert.equal(snap1.tickCount, 1);
    assert.equal(snap1.lastTickMs, 8.0);
    assert.equal(snap1.emaTickMs, 8.0); // Initialized to tickMs on tickCount === 1!
    assert.equal(snap1.maxTickMs, 8.0);

    // Disable mobility_p0_second and run second tick with shorter duration on mobility_p0_first
    assert.equal(pipeline.setSystemEnabled('nonexistent', false), false);
    assert.equal(pipeline.setSystemEnabled('mobility_p0_second', false), true);
    order.length = 0;

    // Override mobility_p0_first duration to 1.0ms on 2nd tick via a wrapper check:
    // On tick 2, mobility_p0_first still adds 3.0; let's add a custom budgeted probe system too
    let dynamicDuration = 4.0;
    pipeline.addSystem({
      name: 'ai_probe',
      phase: 'ai',
      budgetMs: 2.5,
      execute() {
        fakeNow += dynamicDuration;
      },
    });

    pipeline.step(1 / 120);
    assert.equal(order.includes('mobility_p0_second'), false);
    const aiRec = pipeline.getSystemTiming('ai_probe')!;
    assert.equal(aiRec.calls, 1);
    assert.equal(aiRec.emaMs, 4.0);
    assert.equal(aiRec.budgetExceededCount, 1);

    dynamicDuration = 2.0;
    pipeline.step(1 / 120);
    assert.equal(aiRec.calls, 2);
    assert.equal(aiRec.lastMs, 2.0);
    assert.equal(aiRec.emaMs, 0.25 * 2.0 + 0.75 * 4.0); // 3.5
    assert.equal(aiRec.maxMs, 4.0);
    assert.equal(aiRec.budgetExceededCount, 1);

    pipeline.resetTimings();
    assert.equal(pipeline.getTimings().tickCount, 0);
    assert.equal(pipeline.getTimings().emaTickMs, 0);
    assert.equal(aiRec.calls, 0);
    assert.equal(aiRec.emaMs, 0);
    assert.equal(aiRec.maxMs, 0);
    assert.equal(aiRec.budgetExceededCount, 0);
  });

  it('respects flushAfterEachPhase: false and clearEventsAfterTick: false options', () => {
    const world = new World({ maxEntities: 16 });
    const Evt = defineEvent('PersistEvt', { x: 'i32' });
    const e = world.createEntityStrict();

    const pipeline = new SystemPipeline(world, {
      flushAfterEachPhase: false,
      clearEventsAfterTick: false,
    });

    let aliveInCleanup = -1;
    pipeline
      .addSystem({
        name: 'combat_queue',
        phase: 'combat',
        execute(ctx) {
          ctx.world.deferDestroy(e);
          ctx.world.events(Evt).emit({ x: 42 });
        },
      })
      .addSystem({
        name: 'cleanup_observe',
        phase: 'cleanup',
        execute(ctx) {
          aliveInCleanup = ctx.world.aliveCount;
        },
      });

    pipeline.step(1 / 60);
    assert.equal(aliveInCleanup, 1);
    assert.equal(world.deferredDestroyCount, 1);
    assert.equal(world.events(Evt).length, 1);

    assert.equal(world.flushDeferred(), 1);
    assert.equal(world.aliveCount, 0);
  });
});

describe('F10 — 2,048-Entity x 600-Tick 120Hz Benchmark & Source Purity', () => {
  it('sustains < 1.5 ms/tick across 2,048 entities x 600 ticks at 120Hz with zero structural allocations', (t) => {
    const Position = defineComponent('Position', { x: 'f32', y: 'f32', z: 'f32' });
    const Velocity = defineComponent('Velocity', { vx: 'f32', vy: 'f32', vz: 'f32' });
    const Health = defineComponent('Health', { hp: 'f32', maxHp: 'f32' }, { hp: 100, maxHp: 100 });
    const ActiveTag = defineTag('ActiveTag');
    const BounceEvent = defineEvent('BounceEvent', { slot: 'u16', speed: 'f32' }, { capacity: 512 });

    const world = new World({ maxEntities: 2048 });
    const pos = world.getStore(Position);
    const vel = world.getStore(Velocity);
    const hp = world.getStore(Health);
    const bounceEvents = world.events(BounceEvent);

    for (let i = 0; i < 2048; i++) {
      const id = world.createEntityStrict();
      world.addComponent(id, Position, {
        x: (i % 64) - 32,
        y: 1.0,
        z: Math.floor(i / 64) - 16,
      });
      world.addComponent(id, Velocity, {
        vx: ((i * 7) % 11) - 5,
        vy: 0,
        vz: ((i * 13) % 9) - 4,
      });
      world.addComponent(id, Health, { hp: 100, maxHp: 100 });
      if ((i & 1) === 0) {
        world.addComponent(id, ActiveTag);
      }
    }

    const movers = world.query({ all: [Position, Velocity] });
    const activeCombatants = world.query({ all: [Position, Health, ActiveTag] });

    const pipeline = new SystemPipeline(world);
    pipeline
      .addSystem({
        name: 'integrate_mobility',
        phase: 'mobility',
        execute(ctx) {
          const dt = ctx.dt;
          const dense = movers.dense;
          const px = pos.x;
          const py = pos.y;
          const pz = pos.z;
          const vx = vel.vx;
          const vy = vel.vy;
          const vz = vel.vz;
          for (let i = 0, n = movers.count; i < n; i++) {
            const s = dense[i];
            const nx = px[s] + vx[s] * dt;
            const nz = pz[s] + vz[s] * dt;
            py[s] += vy[s] * dt;
            if (nx > 64 || nx < -64) {
              vx[s] = -vx[s];
              const evtSlot = bounceEvents.pushSlot();
              bounceEvents.columns.slot[evtSlot] = s;
              bounceEvents.columns.speed[evtSlot] = Math.abs(vx[s]);
            } else {
              px[s] = nx;
            }
            pz[s] = nz;
          }
        },
      })
      .addSystem({
        name: 'combat_regen',
        phase: 'combat',
        execute(ctx) {
          for (let i = 0, n = bounceEvents.length; i < n; i++) {
            const rSlot = bounceEvents.slotAt(i);
            const targetSlot = bounceEvents.columns.slot[rSlot];
            hp.hp[targetSlot] = Math.max(1, hp.hp[targetSlot] - 0.5);
          }
          const dense = activeCombatants.dense;
          const regen = 2.0 * ctx.dt;
          for (let i = 0, n = activeCombatants.count; i < n; i++) {
            const s = dense[i];
            const nextHp = hp.hp[s] + regen;
            hp.hp[s] = nextHp < hp.maxHp[s] ? nextHp : hp.maxHp[s];
          }
        },
      });

    // Capture structural backing-buffer identities prior to benchmark
    const posXBuffer = pos.x.buffer;
    const velVxBuffer = vel.vx.buffer;
    const moversDenseBuffer = movers.dense.buffer;
    const moversEntitiesBuffer = movers.entities.buffer;
    const bounceSlotBuffer = bounceEvents.columns.slot.buffer;
    const snapshotRef = pipeline.getTimings();
    const systemsRef = snapshotRef.systems;

    // JIT warmup (60 ticks)
    const dt = 1 / 120;
    for (let w = 0; w < 60; w++) {
      pipeline.step(dt);
    }
    pipeline.resetTimings();

    const t0 = performance.now();
    const totalTicks = 600;
    for (let tick = 0; tick < totalTicks; tick++) {
      pipeline.step(dt);
    }
    const totalMs = performance.now() - t0;
    const avgMsPerTick = totalMs / totalTicks;

    t.diagnostic(
      `benchmark 2048 entities x 600 ticks @ 120Hz: total=${totalMs.toFixed(3)}ms, avg=${avgMsPerTick.toFixed(4)}ms/tick, ema=${snapshotRef.emaTickMs.toFixed(4)}ms, max=${snapshotRef.maxTickMs.toFixed(4)}ms`,
    );

    assert.ok(
      avgMsPerTick < 1.5,
      `Expected average 120Hz step < 1.5 ms/tick across 2048 entities, got ${avgMsPerTick.toFixed(4)} ms/tick`,
    );

    // Zero structural buffer reallocations across all 660 ticks
    assert.equal(pos.x.buffer, posXBuffer);
    assert.equal(vel.vx.buffer, velVxBuffer);
    assert.equal(movers.dense.buffer, moversDenseBuffer);
    assert.equal(movers.entities.buffer, moversEntitiesBuffer);
    assert.equal(bounceEvents.columns.slot.buffer, bounceSlotBuffer);
    assert.equal(pipeline.getTimings(), snapshotRef);
    assert.equal(pipeline.getTimings().systems, systemsRef);
    assert.equal(pipeline.getTimings().tickCount, totalTicks);
  });

  it('enforces zero three/react/src/game/DOM imports and zero ts-ignore directives across src/engine/ecs/*.ts', () => {
    const ecsDir = path.resolve(__dirname, '..');
    const sourceFiles = fs
      .readdirSync(ecsDir)
      .filter((name) => name.endsWith('.ts'))
      .sort();

    assert.deepEqual(sourceFiles, [
      'ComponentStore.ts',
      'EntityId.ts',
      'EventRingBuffer.ts',
      'Query.ts',
      'SparseSet.ts',
      'SystemPipeline.ts',
      'World.ts',
      'index.ts',
    ]);

    for (const file of sourceFiles) {
      const src = fs.readFileSync(path.join(ecsDir, file), 'utf8');
      assert.equal(/@ts-(nocheck|ignore|expect-error)/.test(src), false, `Forbidden TS suppression in ${file}`);
      assert.equal(/from\s+['"](three|react|react-dom)/.test(src), false, `Forbidden framework import in ${file}`);
      assert.equal(/src\/game|\.\.\/\.\.\/game/.test(src), false, `Forbidden game import in ${file}`);
      assert.equal(/\b(window|document|HTMLElement|HTMLCanvasElement|WebGLRenderingContext)\b/.test(src), false, `Forbidden DOM global in ${file}`);
    }
  });
});
