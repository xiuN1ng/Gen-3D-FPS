export type FieldType = 'f32' | 'f64' | 'i32' | 'u32' | 'i16' | 'u16' | 'i8' | 'u8';
export type ComponentSchema = Record<string, FieldType>;

export type FieldArrayMap = {
  f32: Float32Array;
  f64: Float64Array;
  i32: Int32Array;
  u32: Uint32Array;
  i16: Int16Array;
  u16: Uint16Array;
  i8: Int8Array;
  u8: Uint8Array;
};

export type SoAColumns<S extends ComponentSchema> = {
  readonly [K in keyof S]: FieldArrayMap[S[K]];
};

export interface ComponentDef<S extends ComponentSchema = ComponentSchema> {
  readonly name: string;
  readonly schema: S;
  readonly isTag: boolean;
  readonly defaults: Readonly<Partial<Record<keyof S, number>>>;
}

export type NumericTypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;

export const COMP_UID: unique symbol = Symbol('ecs.component.uid');

export interface InternalComponentDef<S extends ComponentSchema = ComponentSchema>
  extends ComponentDef<S> {
  readonly [COMP_UID]?: number;
}

let nextComponentUid = 0;
const EMPTY_FROZEN_OBJECT = Object.freeze({});

export function isValidFieldType(type: unknown): type is FieldType {
  return (
    type === 'f32' ||
    type === 'f64' ||
    type === 'i32' ||
    type === 'u32' ||
    type === 'i16' ||
    type === 'u16' ||
    type === 'i8' ||
    type === 'u8'
  );
}

export function createTypedColumn<T extends FieldType>(
  type: T,
  capacity: number,
): FieldArrayMap[T] {
  switch (type) {
    case 'f32':
      return new Float32Array(capacity) as FieldArrayMap[T];
    case 'f64':
      return new Float64Array(capacity) as FieldArrayMap[T];
    case 'i32':
      return new Int32Array(capacity) as FieldArrayMap[T];
    case 'u32':
      return new Uint32Array(capacity) as FieldArrayMap[T];
    case 'i16':
      return new Int16Array(capacity) as FieldArrayMap[T];
    case 'u16':
      return new Uint16Array(capacity) as FieldArrayMap[T];
    case 'i8':
      return new Int8Array(capacity) as FieldArrayMap[T];
    case 'u8':
      return new Uint8Array(capacity) as FieldArrayMap[T];
    default:
      throw new TypeError(`Unsupported FieldType: ${String(type)}`);
  }
}

export function defineComponent<S extends ComponentSchema>(
  name: string,
  schema: S,
  defaults?: Partial<Record<keyof S, number>>,
): ComponentDef<S> {
  const keys = Object.keys(schema);
  const schemaCopy: Record<string, FieldType> = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const fieldType = schema[key];
    if (!isValidFieldType(fieldType)) {
      throw new TypeError(
        `Invalid FieldType "${String(fieldType)}" on field "${key}" in component "${name}"`,
      );
    }
    schemaCopy[key] = fieldType;
  }

  let frozenDefaults: Readonly<Partial<Record<keyof S, number>>>;
  if (defaults !== undefined && keys.length > 0) {
    const defaultsCopy: Partial<Record<keyof S, number>> = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as keyof S;
      const val = defaults[key];
      if (val !== undefined) {
        defaultsCopy[key] = val;
      }
    }
    frozenDefaults = Object.freeze(defaultsCopy);
  } else {
    frozenDefaults = EMPTY_FROZEN_OBJECT as Readonly<Partial<Record<keyof S, number>>>;
  }

  const def: ComponentDef<S> = {
    name,
    schema: Object.freeze(schemaCopy) as S,
    isTag: keys.length === 0,
    defaults: frozenDefaults,
  };
  Object.defineProperty(def, COMP_UID, {
    value: nextComponentUid++,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(def);
}

export function defineTag(name: string): ComponentDef<Record<string, never>> {
  return defineComponent<Record<string, never>>(name, {});
}

export class ComponentStorage<S extends ComponentSchema = ComponentSchema> {
  readonly def: ComponentDef<S>;
  readonly columns: SoAColumns<S>;
  private readonly _fieldNames: readonly string[];
  private readonly _fieldArrays: readonly NumericTypedArray[];
  private readonly _fieldDefaults: Float64Array;

  constructor(def: ComponentDef<S>, capacity: number) {
    this.def = def;
    if (def.isTag) {
      this.columns = EMPTY_FROZEN_OBJECT as SoAColumns<S>;
      this._fieldNames = [];
      this._fieldArrays = [];
      this._fieldDefaults = new Float64Array(0);
      return;
    }

    const keys = Object.keys(def.schema);
    const cols: Record<string, NumericTypedArray> = {};
    const arrays: NumericTypedArray[] = new Array<NumericTypedArray>(keys.length);
    const defaults = new Float64Array(keys.length);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const type = def.schema[key];
      const col = createTypedColumn(type, capacity);
      const defaultVal = def.defaults[key as keyof S] ?? 0;
      defaults[i] = defaultVal;
      if (defaultVal !== 0) {
        col.fill(defaultVal);
      }
      cols[key] = col;
      arrays[i] = col;
    }

    this.columns = Object.freeze(cols) as SoAColumns<S>;
    this._fieldNames = keys;
    this._fieldArrays = arrays;
    this._fieldDefaults = defaults;
  }

  initSlot(slot: number, init?: Partial<Record<keyof S, number>>): void {
    const arrays = this._fieldArrays;
    const defaults = this._fieldDefaults;
    const n = arrays.length;
    if (n === 0) return;

    if (init === undefined) {
      for (let i = 0; i < n; i++) {
        arrays[i][slot] = defaults[i];
      }
      return;
    }

    const names = this._fieldNames;
    const initRecord = init as Record<string, number | undefined>;
    for (let i = 0; i < n; i++) {
      const val = initRecord[names[i]];
      arrays[i][slot] = val !== undefined ? val : defaults[i];
    }
  }

  patchSlot(slot: number, init?: Partial<Record<keyof S, number>>): void {
    if (init === undefined) return;
    const arrays = this._fieldArrays;
    const n = arrays.length;
    if (n === 0) return;

    const names = this._fieldNames;
    const initRecord = init as Record<string, number | undefined>;
    for (let i = 0; i < n; i++) {
      const val = initRecord[names[i]];
      if (val !== undefined) {
        arrays[i][slot] = val;
      }
    }
  }

  resetSlot(slot: number): void {
    const arrays = this._fieldArrays;
    const defaults = this._fieldDefaults;
    for (let i = 0, n = arrays.length; i < n; i++) {
      arrays[i][slot] = defaults[i];
    }
  }

  resetAll(): void {
    const arrays = this._fieldArrays;
    const defaults = this._fieldDefaults;
    for (let i = 0, n = arrays.length; i < n; i++) {
      arrays[i].fill(defaults[i]);
    }
  }
}
