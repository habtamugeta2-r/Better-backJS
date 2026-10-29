import type { ConcreteConstructor } from '../di/tokens.js';

/**
 * Ensures ECMAScript Stage-3 `Symbol.metadata` is defined on runtimes (e.g. Node 20)
 * where `Symbol.metadata` is not yet exposed on the global `Symbol` constructor.
 * Zero `reflect-metadata` required.
 */
export const METADATA_SYMBOL: symbol = (() => {
  const existing: unknown = Reflect.get(Symbol, 'metadata');
  if (typeof existing !== 'symbol') {
    const fallback = Symbol.for('Symbol.metadata');
    Object.defineProperty(Symbol, 'metadata', {
      value: fallback,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return fallback;
  }
  return existing;
})();

export type MetadataRecord = Record<PropertyKey, unknown>;

export function hasOwnMetadata(meta: MetadataRecord, key: symbol): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

export function readClassMetadata(ctor: ConcreteConstructor): MetadataRecord | undefined {
  const raw: unknown = Reflect.get(ctor, METADATA_SYMBOL);
  if (typeof raw === 'object' && raw !== null) {
    return raw as MetadataRecord;
  }
  return undefined;
}

export function ensureOwnArray<T>(meta: MetadataRecord, key: symbol): T[] {
  if (!hasOwnMetadata(meta, key)) {
    meta[key] = [];
  }
  return meta[key] as T[];
}

export function ensureOwnMap<K, V>(meta: MetadataRecord, key: symbol): Map<K, V> {
  if (!hasOwnMetadata(meta, key)) {
    meta[key] = new Map<K, V>();
  }
  return meta[key] as Map<K, V>;
}

export function ensureOwnSet<T>(meta: MetadataRecord, key: symbol): Set<T> {
  if (!hasOwnMetadata(meta, key)) {
    meta[key] = new Set<T>();
  }
  return meta[key] as Set<T>;
}
