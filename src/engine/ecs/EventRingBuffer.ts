import {
  createTypedColumn,
  isValidFieldType,
  type ComponentSchema,
  type FieldType,
  type NumericTypedArray,
  type SoAColumns,
} from './ComponentStore';

export type EventOverflowPolicy = 'overwrite-oldest' | 'drop-newest';

export interface EventDef<S extends ComponentSchema = ComponentSchema> {
  readonly name: string;
  readonly schema: S;
  readonly capacity: number;
  readonly overflow: EventOverflowPolicy;
}

export interface EventCursor {
  seq: number;
}

export const EVENT_UID: unique symbol = Symbol('ecs.event.uid');

export interface InternalEventDef<S extends ComponentSchema = ComponentSchema> extends EventDef<S> {
  readonly [EVENT_UID]?: number;
}

const DEFAULT_EVENT_CAPACITY = 256;
const MAX_EVENT_CAPACITY = 0x40000000;
const EMPTY_FROZEN_OBJECT = Object.freeze({});
let nextEventUid = 0;

function normalizeCapacity(rawCapacity: number | undefined): number {
  if (rawCapacity === undefined) {
    return DEFAULT_EVENT_CAPACITY;
  }
  if (!Number.isFinite(rawCapacity) || rawCapacity > MAX_EVENT_CAPACITY) {
    throw new RangeError(`Invalid EventRingBuffer capacity: ${rawCapacity}`);
  }
  const intCap = Math.ceil(rawCapacity);
  if (intCap <= 2) {
    return 2;
  }
  return 1 << (32 - Math.clz32(intCap - 1));
}

export function defineEvent<S extends ComponentSchema>(
  name: string,
  schema: S,
  options?: { capacity?: number; overflow?: EventOverflowPolicy },
): EventDef<S> {
  const keys = Object.keys(schema);
  const schemaCopy: Record<string, FieldType> = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const type = schema[key];
    if (!isValidFieldType(type)) {
      throw new TypeError(
        `Invalid FieldType "${String(type)}" on field "${key}" in event "${name}"`,
      );
    }
    schemaCopy[key] = type;
  }

  const capacity = normalizeCapacity(options?.capacity);
  const overflow: EventOverflowPolicy = options?.overflow ?? 'overwrite-oldest';
  if (overflow !== 'overwrite-oldest' && overflow !== 'drop-newest') {
    throw new TypeError(`Invalid EventOverflowPolicy: ${String(overflow)}`);
  }

  const def: EventDef<S> = {
    name,
    schema: Object.freeze(schemaCopy) as S,
    capacity,
    overflow,
  };
  Object.defineProperty(def, EVENT_UID, {
    value: nextEventUid++,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(def);
}

export class EventRingBuffer<S extends ComponentSchema = ComponentSchema> {
  readonly def: EventDef<S>;
  readonly capacity: number;
  readonly columns: SoAColumns<S>;

  private readonly _mask: number;
  private readonly _overwriteOldest: boolean;
  private readonly _fieldNames: readonly string[];
  private readonly _fieldArrays: readonly NumericTypedArray[];

  private _headSeq = 0;
  private _writeSeq = 0;
  private _totalWritten = 0;
  private _droppedCount = 0;
  private _overflowCount = 0;

  constructor(def: EventDef<S>) {
    this.def = def;
    this.capacity = normalizeCapacity(def.capacity);
    this._mask = this.capacity - 1;
    this._overwriteOldest = def.overflow !== 'drop-newest';

    const keys = Object.keys(def.schema);
    if (keys.length === 0) {
      this.columns = EMPTY_FROZEN_OBJECT as SoAColumns<S>;
      this._fieldNames = [];
      this._fieldArrays = [];
      return;
    }

    const cols: Record<string, NumericTypedArray> = {};
    const arrays: NumericTypedArray[] = new Array<NumericTypedArray>(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const col = createTypedColumn(def.schema[key], this.capacity);
      cols[key] = col;
      arrays[i] = col;
    }
    this.columns = Object.freeze(cols) as SoAColumns<S>;
    this._fieldNames = keys;
    this._fieldArrays = arrays;
  }

  get length(): number {
    return this._writeSeq - this._headSeq;
  }

  get totalWritten(): number {
    return this._totalWritten;
  }

  get droppedCount(): number {
    return this._droppedCount;
  }

  get overflowCount(): number {
    return this._overflowCount;
  }

  pushSlot(): number {
    const currentLen = this._writeSeq - this._headSeq;
    if (currentLen === this.capacity) {
      this._overflowCount++;
      if (!this._overwriteOldest) {
        this._droppedCount++;
        return -1;
      }
      this._headSeq++;
    }

    const slot = this._writeSeq & this._mask;
    const arrays = this._fieldArrays;
    for (let i = 0, n = arrays.length; i < n; i++) {
      arrays[i][slot] = 0;
    }

    this._writeSeq++;
    this._totalWritten++;
    return slot;
  }

  emit(payload: Readonly<{ [K in keyof S]?: number }>): boolean {
    const slot = this.pushSlot();
    if (slot === -1) {
      return false;
    }

    const arrays = this._fieldArrays;
    const names = this._fieldNames;
    const record = payload as Record<string, number | undefined>;
    for (let i = 0, n = arrays.length; i < n; i++) {
      const val = record[names[i]];
      if (val !== undefined) {
        arrays[i][slot] = val;
      }
    }
    return true;
  }

  slotAt(logicalIndex: number): number {
    const len = this._writeSeq - this._headSeq;
    if (logicalIndex < 0 || logicalIndex >= len || (logicalIndex | 0) !== logicalIndex) {
      return -1;
    }
    return (this._headSeq + logicalIndex) & this._mask;
  }

  createCursor(): EventCursor {
    return { seq: this._headSeq };
  }

  readCursor(cursor: EventCursor, fn: (ringSlot: number) => void): number {
    let seq = cursor.seq;
    if (seq < this._headSeq) {
      seq = this._headSeq;
    } else if (seq > this._writeSeq) {
      seq = this._writeSeq;
      cursor.seq = seq;
      return 0;
    }

    const endSeq = this._writeSeq;
    const mask = this._mask;
    let count = 0;
    while (seq < endSeq) {
      const current = seq++;
      cursor.seq = seq;
      fn(current & mask);
      count++;
      if (seq < this._headSeq) {
        seq = this._headSeq;
        cursor.seq = seq;
      }
    }
    cursor.seq = seq;
    return count;
  }

  clear(): void {
    this._headSeq = this._writeSeq;
  }

  resetStats(): void {
    this._totalWritten = 0;
    this._droppedCount = 0;
    this._overflowCount = 0;
  }
}
