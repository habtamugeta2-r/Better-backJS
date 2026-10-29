import { createPaginatedResponseSchema, PaginationQuerySchema } from 'better-back';
import { z } from 'zod';

/**
 * Branded UserId prevents passing arbitrary strings or PostIds where a UserId is required.
 */
export const UserIdSchema = z.uuid().brand<'UserId'>().describe('Unique UUIDv4 user identifier');
export type UserId = z.output<typeof UserIdSchema>;

export const UserRoleSchema = z.enum(['admin', 'member', 'viewer']);
export type UserRole = z.output<typeof UserRoleSchema>;

/**
 * Single Source of Truth for User entity representation:
 * Drives runtime validation, TypeScript static types, and hoisted OpenAPI 3.1 `#/components/schemas/User`.
 */
export const UserSchema = z
  .object({
    id: UserIdSchema,
    email: z.email().describe('Primary unique email address'),
    name: z.string().trim().min(2).max(80).describe('Display name'),
    role: UserRoleSchema.default('member'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User', title: 'User', description: 'Registered user account' });

export type User = z.output<typeof UserSchema>;

export const CreateUserSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(2).max(80),
    role: UserRoleSchema.default('member'),
  })
  .meta({ id: 'CreateUserInput', title: 'CreateUserInput' });

export type CreateUserInput = z.output<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    email: z.email().optional(),
    name: z.string().trim().min(2).max(80).optional(),
    role: UserRoleSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update a user.',
  })
  .meta({ id: 'UpdateUserInput', title: 'UpdateUserInput' });

export type UpdateUserInput = z.output<typeof UpdateUserSchema>;

export const UserIdParamsSchema = z.object({
  id: UserIdSchema,
});

export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  role: UserRoleSchema.optional(),
});

export type ListUsersQuery = z.output<typeof ListUsersQuerySchema>;

export const PaginatedUsersResponseSchema = createPaginatedResponseSchema(UserSchema).meta({
  id: 'PaginatedUsersResponse',
  title: 'PaginatedUsersResponse',
});
