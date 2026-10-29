import { randomUUID } from 'node:crypto';
import { createToken, Injectable } from 'better-back';
import {
  UserIdSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
  type User,
  type UserId,
} from './users.schema.js';

/**
 * Database-agnostic Repository Port (Hard Constraint 5).
 * Swap with Prisma, Drizzle, Knex, or pg Pool without touching `UsersService` or `UsersController`.
 */
export interface UserRepository {
  findMany(
    query: ListUsersQuery,
  ): Promise<{ readonly items: readonly User[]; readonly total: number }>;
  findById(id: UserId): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  create(input: CreateUserInput): Promise<User>;
  update(id: UserId, input: UpdateUserInput): Promise<User | undefined>;
  delete(id: UserId): Promise<boolean>;
  ping(): Promise<boolean>;
}

export const UserRepositoryToken = createToken<UserRepository>('UserRepository');

@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly store = new Map<UserId, User>();

  public async findMany(
    query: ListUsersQuery,
  ): Promise<{ readonly items: readonly User[]; readonly total: number }> {
    const filtered = [...this.store.values()].filter((u) =>
      query.role ? u.role === query.role : true,
    );

    filtered.sort((a, b) => {
      const cmp = a.createdAt.localeCompare(b.createdAt);
      return query.order === 'desc' ? -cmp : cmp;
    });

    const offset = (query.page - 1) * query.limit;
    const items = filtered.slice(offset, offset + query.limit);
    return { items, total: filtered.length };
  }

  public async findById(id: UserId): Promise<User | undefined> {
    return this.store.get(id);
  }

  public async findByEmail(email: string): Promise<User | undefined> {
    const normalized = email.toLowerCase();
    for (const user of this.store.values()) {
      if (user.email.toLowerCase() === normalized) {
        return user;
      }
    }
    return undefined;
  }

  public async create(input: CreateUserInput): Promise<User> {
    const id = UserIdSchema.parse(randomUUID());
    const user: User = {
      id,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    this.store.set(id, user);
    return user;
  }

  public async update(id: UserId, input: UpdateUserInput): Promise<User | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;

    const updated: User = {
      ...existing,
      ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
    };
    this.store.set(id, updated);
    return updated;
  }

  public async delete(id: UserId): Promise<boolean> {
    return this.store.delete(id);
  }

  public async ping(): Promise<boolean> {
    return true;
  }
}
