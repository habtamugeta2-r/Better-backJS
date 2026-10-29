/**
 * Standard Schema v1 (`~standard`) & Standard JSON Schema v1 structural contracts.
 *
 * Natively implemented by Zod v4 (`zod@^4.6`), Valibot v1+, ArkType v2+, Effect Schema,
 * and custom schema objects with zero per-library adapters.
 */

export interface StandardSchemaPathSegment {
  readonly key: PropertyKey;
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly code?: string | undefined;
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined;
}

export interface StandardSchemaSuccessResult<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}

export interface StandardSchemaFailureResult {
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
}

export type StandardSchemaResult<Output> =
  StandardSchemaSuccessResult<Output> | StandardSchemaFailureResult;

export interface StandardSchemaOptions {
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export interface StandardSchemaTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

export type StandardJsonSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {});

export interface StandardJsonSchemaOptions {
  readonly target: StandardJsonSchemaTarget;
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export interface StandardJsonSchemaConverter {
  readonly input: (options: StandardJsonSchemaOptions) => Record<string, unknown>;
  readonly output: (options: StandardJsonSchemaOptions) => Record<string, unknown>;
}

export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly types?: StandardSchemaTypes<Input, Output> | undefined;
  readonly validate: (
    value: unknown,
    options?: StandardSchemaOptions | undefined,
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  readonly jsonSchema?: StandardJsonSchemaConverter | undefined;
}

/**
 * Any schema implementing the Standard Schema v1 specification (including all `z.ZodType` instances).
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>;
}

export type InferSchemaInput<TSchema extends StandardSchemaV1> = NonNullable<
  TSchema['~standard']['types']
>['input'];

export type InferSchemaOutput<TSchema extends StandardSchemaV1> = NonNullable<
  TSchema['~standard']['types']
>['output'];

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }
  const std = (value as { readonly '~standard'?: unknown })['~standard'];
  return (
    typeof std === 'object' &&
    std !== null &&
    (std as { readonly version?: unknown }).version === 1 &&
    typeof (std as { readonly validate?: unknown }).validate === 'function'
  );
}
