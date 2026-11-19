export type EntityId = number;

export const NULL_ENTITY: EntityId = 0;
export const ENTITY_INDEX_BITS = 12;
export const ENTITY_INDEX_MASK = 0xfff;
export const ENTITY_GEN_BITS = 19;
export const ENTITY_GEN_MASK = 0x7ffff;
export const DEFAULT_MAX_ENTITIES = 2048;
export const MAX_SUPPORTED_ENTITIES = 4096;
export const MAX_COMPONENTS = 64;

export function packEntityId(index: number, generation: number): EntityId {
  return ((generation & ENTITY_GEN_MASK) << ENTITY_INDEX_BITS) | (index & ENTITY_INDEX_MASK);
}

export function entityIndex(id: EntityId): number {
  return id & ENTITY_INDEX_MASK;
}

export function entityGeneration(id: EntityId): number {
  return (id >>> ENTITY_INDEX_BITS) & ENTITY_GEN_MASK;
}

export function nextGeneration(gen: number): number {
  const next = ((gen & ENTITY_GEN_MASK) + 1) & ENTITY_GEN_MASK;
  return next === 0 ? 1 : next;
}
