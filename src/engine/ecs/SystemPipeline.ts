import type { World } from './World';

export const SYSTEM_PHASES = [
  'input',
  'ai',
  'mobility',
  'projectile',
  'broadphase',
  'collision',
  'combat',
  'cleanup',
  'telemetry',
] as const;

export type SystemPhase = (typeof SYSTEM_PHASES)[number];

export interface SystemContext {
  readonly world: World;
  dt: number;
  tick: number;
  elapsed: number;
}

export interface SystemDef {
  readonly name: string;
  readonly phase: SystemPhase;
  readonly priority?: number;
  readonly budgetMs?: number;
  readonly enabled?: boolean;
  execute(ctx: SystemContext): void;
}

export interface SystemTimingRecord {
  readonly name: string;
  readonly phase: SystemPhase;
  readonly budgetMs: number;
  enabled: boolean;
  calls: number;
  lastMs: number;
  emaMs: number;
  maxMs: number;
  budgetExceededCount: number;
}

export interface PipelineTimingSnapshot {
  readonly tickCount: number;
  readonly lastTickMs: number;
  readonly emaTickMs: number;
  readonly maxTickMs: number;
  readonly systems: readonly SystemTimingRecord[];
}

export interface SystemPipelineOptions {
  now?: () => number;
  emaAlpha?: number;
  flushAfterEachPhase?: boolean;
  clearEventsAfterTick?: boolean;
}

interface InternalSystemEntry {
  readonly def: SystemDef;
  readonly phaseOrdinal: number;
  readonly priority: number;
  readonly order: number;
  readonly record: SystemTimingRecord;
}

interface MutablePipelineTimingSnapshot {
  tickCount: number;
  lastTickMs: number;
  emaTickMs: number;
  maxTickMs: number;
  readonly systems: SystemTimingRecord[];
}

const PHASE_ORDINAL: Readonly<Record<SystemPhase, number>> = {
  input: 0,
  ai: 1,
  mobility: 2,
  projectile: 3,
  broadphase: 4,
  collision: 5,
  combat: 6,
  cleanup: 7,
  telemetry: 8,
};

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class SystemPipeline {
  private readonly _world: World;
  private readonly _now: () => number;
  private readonly _emaAlpha: number;
  private readonly _oneMinusAlpha: number;
  private readonly _flushAfterEachPhase: boolean;
  private readonly _clearEventsAfterTick: boolean;

  private readonly _ctx: SystemContext;
  private readonly _entries: InternalSystemEntry[] = [];
  private readonly _phaseBuckets: InternalSystemEntry[][];
  private readonly _byName = new Map<string, InternalSystemEntry>();
  private readonly _snapshot: MutablePipelineTimingSnapshot;

  private _nextRegistrationOrder = 0;

  constructor(world: World, options?: SystemPipelineOptions) {
    const alpha = options?.emaAlpha ?? 0.1;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new RangeError(`emaAlpha must be in [0, 1], got ${alpha}`);
    }

    this._world = world;
    this._now = options?.now ?? defaultNow;
    this._emaAlpha = alpha;
    this._oneMinusAlpha = 1 - alpha;
    this._flushAfterEachPhase = options?.flushAfterEachPhase ?? true;
    this._clearEventsAfterTick = options?.clearEventsAfterTick ?? true;

    this._ctx = {
      world,
      dt: 0,
      tick: 0,
      elapsed: 0,
    };

    const buckets: InternalSystemEntry[][] = new Array<InternalSystemEntry[]>(SYSTEM_PHASES.length);
    for (let i = 0; i < SYSTEM_PHASES.length; i++) {
      buckets[i] = [];
    }
    this._phaseBuckets = buckets;

    this._snapshot = {
      tickCount: 0,
      lastTickMs: 0,
      emaTickMs: 0,
      maxTickMs: 0,
      systems: [],
    };
  }

  addSystem(system: SystemDef): this {
    const phaseOrdinal = PHASE_ORDINAL[system.phase];
    if (phaseOrdinal === undefined) {
      throw new RangeError(`Unknown SystemPhase: "${String(system.phase)}"`);
    }
    if (this._byName.has(system.name)) {
      throw new Error(`Duplicate system name "${system.name}" in SystemPipeline`);
    }

    const record: SystemTimingRecord = {
      name: system.name,
      phase: system.phase,
      budgetMs: system.budgetMs ?? Number.POSITIVE_INFINITY,
      enabled: system.enabled ?? true,
      calls: 0,
      lastMs: 0,
      emaMs: 0,
      maxMs: 0,
      budgetExceededCount: 0,
    };

    const entry: InternalSystemEntry = {
      def: system,
      phaseOrdinal,
      priority: system.priority ?? 0,
      order: this._nextRegistrationOrder++,
      record,
    };

    this._byName.set(system.name, entry);
    this._entries.push(entry);
    this._entries.sort((a, b) => {
      if (a.phaseOrdinal !== b.phaseOrdinal) {
        return a.phaseOrdinal - b.phaseOrdinal;
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.order - b.order;
    });

    const bucket = this._phaseBuckets[phaseOrdinal];
    bucket.push(entry);
    bucket.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.order - b.order));

    const records = this._snapshot.systems;
    records.length = this._entries.length;
    for (let i = 0; i < this._entries.length; i++) {
      records[i] = this._entries[i].record;
    }

    return this;
  }

  setSystemEnabled(name: string, enabled: boolean): boolean {
    const entry = this._byName.get(name);
    if (entry === undefined) {
      return false;
    }
    entry.record.enabled = enabled;
    return true;
  }

  step(dt: number): void {
    const now = this._now;
    const alpha = this._emaAlpha;
    const oneMinusAlpha = this._oneMinusAlpha;
    const world = this._world;
    const ctx = this._ctx;

    const tickStart = now();

    ctx.dt = dt;
    ctx.tick++;
    ctx.elapsed += dt;

    const buckets = this._phaseBuckets;
    const flushPhase = this._flushAfterEachPhase;

    for (let p = 0; p < buckets.length; p++) {
      const bucket = buckets[p];
      for (let i = 0, n = bucket.length; i < n; i++) {
        const entry = bucket[i];
        const rec = entry.record;
        if (!rec.enabled) {
          continue;
        }
        const sysStart = now();
        entry.def.execute(ctx);
        const rawSysMs = now() - sysStart;
        const sysMs = rawSysMs < 0 ? 0 : rawSysMs;

        const calls = ++rec.calls;
        rec.lastMs = sysMs;
        rec.emaMs = calls === 1 ? sysMs : alpha * sysMs + oneMinusAlpha * rec.emaMs;
        if (sysMs > rec.maxMs) {
          rec.maxMs = sysMs;
        }
        if (sysMs > rec.budgetMs) {
          rec.budgetExceededCount++;
        }
      }

      if (flushPhase && world.deferredDestroyCount > 0) {
        world.flushDeferred();
      }
    }

    if (this._clearEventsAfterTick) {
      world.clearEvents();
    }

    const rawTickMs = now() - tickStart;
    const tickMs = rawTickMs < 0 ? 0 : rawTickMs;
    const snapshot = this._snapshot;
    const tickCount = ++snapshot.tickCount;
    snapshot.lastTickMs = tickMs;
    snapshot.emaTickMs =
      tickCount === 1 ? tickMs : alpha * tickMs + oneMinusAlpha * snapshot.emaTickMs;
    if (tickMs > snapshot.maxTickMs) {
      snapshot.maxTickMs = tickMs;
    }
  }

  getSystemTiming(name: string): SystemTimingRecord | undefined {
    return this._byName.get(name)?.record;
  }

  getTimings(): PipelineTimingSnapshot {
    return this._snapshot;
  }

  resetTimings(): void {
    const snapshot = this._snapshot;
    snapshot.tickCount = 0;
    snapshot.lastTickMs = 0;
    snapshot.emaTickMs = 0;
    snapshot.maxTickMs = 0;

    const entries = this._entries;
    for (let i = 0; i < entries.length; i++) {
      const rec = entries[i].record;
      rec.calls = 0;
      rec.lastMs = 0;
      rec.emaMs = 0;
      rec.maxMs = 0;
      rec.budgetExceededCount = 0;
    }
  }
}
