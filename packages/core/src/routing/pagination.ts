import { z } from 'zod';

export interface PaginationOptions {
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}

export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPrevPage: boolean;
}

export interface PaginatedResult<TItem> {
  readonly data: readonly TItem[];
  readonly meta: PaginationMeta;
}

/**
 * Creates a standardized, bounded pagination query Zod schema (`page`, `limit`, `sort`, `order`).
 * Bounds `limit <= maxLimit` (default 100) to protect against OWASP API4 resource exhaustion.
 */
export function createPaginationQuerySchema(options: PaginationOptions = {}) {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;

  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    sort: z.string().trim().min(1).max(64).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
  });
}

export const PaginationQuerySchema = createPaginationQuerySchema();

export type PaginationQuery = z.output<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

/**
 * Wraps an item Zod schema into a standardized paginated response schema `{ data, meta }`.
 */
export function createPaginatedResponseSchema<TItem extends z.ZodType>(itemSchema: TItem) {
  return z.object({
    data: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });
}

/**
 * Computes deterministic pagination metadata for a slice of items.
 */
export function paginate<TItem>(
  items: readonly TItem[],
  total: number,
  query: Pick<PaginationQuery, 'page' | 'limit'>,
): PaginatedResult<TItem> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);
  return {
    data: items,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1,
    },
  };
}
