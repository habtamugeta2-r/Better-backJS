import { hasOwnMetadata, readClassMetadata, type MetadataRecord } from '../common/metadata.js';
import type { ConcreteConstructor, Scope } from './tokens.js';

export interface InjectableOptions {
  readonly scope?: Scope;
}

const INJECTABLE_META_KEY = Symbol.for('better-back.injectable');

/**
 * Standard ECMAScript Stage-3 `@Injectable()` decorator.
 * Requires ZERO `reflect-metadata` and ZERO `experimentalDecorators`.
 */
export function Injectable(options: InjectableOptions = {}) {
  return function <TClass extends ConcreteConstructor>(
    _target: TClass,
    context: ClassDecoratorContext<TClass>,
  ): void {
    if (context.kind !== 'class') {
      throw new TypeError('@Injectable can only decorate classes.');
    }
    const meta = context.metadata as MetadataRecord;
    meta[INJECTABLE_META_KEY] = options;
  };
}

export function getInjectableMetadata(target: ConcreteConstructor): InjectableOptions | undefined {
  const meta = readClassMetadata(target);
  if (!meta || !hasOwnMetadata(meta, INJECTABLE_META_KEY)) {
    return undefined;
  }
  return meta[INJECTABLE_META_KEY] as InjectableOptions;
}
