import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  createToken,
  inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from 'better-back';
import type { UserRepository } from './users.repository.js';
import {
  UserIdSchema,
  UserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
  type User,
  type UserId,
} from './users.schema.js';

export const WalFilePathToken = createToken<string>('WalFilePath');

type WalEntry =
  | { readonly op: 'PUT'; readonly user: User }
  | { readonly op: 'DEL'; readonly id: UserId }
  | {
      readonly op: 'TX';
      readonly ops: readonly (
        { readonly op: 'PUT'; readonly user: User } | { readonly op: 'DEL'; readonly id: UserId }
      )[];
    };

/**
 * Durable, crash-safe Write-Ahead-Log (`WAL`) implementation of `UserRepository`
 * demonstrating `OnModuleInit`, `OnApplicationShutdown`, atomic `withTransaction()` rollback,
 * and zero core database coupling (swap into `UserRepositoryToken` without touching `UsersService`).
 */
@Injectable()
export class WalUserRepository implements UserRepository, OnModuleInit, OnApplicationShutdown {
  private readonly filePath: string;
  private readonly store = new Map<UserId, User>();
  private handle: FileHandle | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(explicitFilePath?: string) {
    this.filePath = explicitFilePath ?? inject(WalFilePathToken);
  }

  public async onModuleInit(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let existingContent: string;
    try {
      existingContent = await readFile(this.filePath, 'utf8');
    } catch {
      existingContent = '';
    }

    for (const rawLine of existingContent.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as WalEntry;
        this.applyEntryInMemory(entry);
      } catch {
        // Ignore torn/incomplete trailing line from an unclean power loss
      }
    }

    this.handle = await open(this.filePath, 'a');
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.writeChain;
    if (this.handle) {
      const h = this.handle;
      this.handle = undefined;
      await h.datasync();
      await h.close();
    }
  }

  public get isOpen(): boolean {
    return this.handle !== undefined;
  }

  public async ping(): Promise<boolean> {
    return this.handle !== undefined;
  }

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
    const user: User = UserSchema.parse({
      id,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      createdAt: new Date().toISOString(),
    });
    await this.appendWal({ op: 'PUT', user });
    this.store.set(id, user);
    return user;
  }

  public async update(id: UserId, input: UpdateUserInput): Promise<User | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;

    const updated: User = UserSchema.parse({
      ...existing,
      ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
    });
    await this.appendWal({ op: 'PUT', user: updated });
    this.store.set(id, updated);
    return updated;
  }

  public async delete(id: UserId): Promise<boolean> {
    if (!this.store.has(id)) return false;
    await this.appendWal({ op: 'DEL', id });
    return this.store.delete(id);
  }

  /**
   * Executes a multi-step unit of work atomically against a staged copy of the store.
   * Commits a single atomic `TX` WAL record on success, or discards all staged mutations on throw.
   */
  public async withTransaction<T>(
    work: (txRepo: Pick<UserRepository, 'create' | 'delete' | 'findByEmail'>) => Promise<T>,
  ): Promise<T> {
    const stagedStore = new Map<UserId, User>(this.store);
    const stagedOps: (
      { readonly op: 'PUT'; readonly user: User } | { readonly op: 'DEL'; readonly id: UserId }
    )[] = [];

    const txView: Pick<UserRepository, 'create' | 'delete' | 'findByEmail'> = {
      findByEmail: async (email: string) => {
        const normalized = email.toLowerCase();
        for (const u of stagedStore.values()) {
          if (u.email.toLowerCase() === normalized) return u;
        }
        return undefined;
      },
      create: async (input: CreateUserInput) => {
        const id = UserIdSchema.parse(randomUUID());
        const user: User = UserSchema.parse({
          id,
          email: input.email.toLowerCase(),
          name: input.name,
          role: input.role,
          createdAt: new Date().toISOString(),
        });
        stagedStore.set(id, user);
        stagedOps.push({ op: 'PUT', user });
        return user;
      },
      delete: async (id: UserId) => {
        if (!stagedStore.delete(id)) return false;
        stagedOps.push({ op: 'DEL', id });
        return true;
      },
    };

    const result = await work(txView);

    if (stagedOps.length > 0) {
      await this.appendWal({ op: 'TX', ops: stagedOps });
      this.store.clear();
      for (const [k, v] of stagedStore) {
        this.store.set(k, v);
      }
    }

    return result;
  }

  private applyEntryInMemory(entry: WalEntry): void {
    if (entry.op === 'PUT') {
      const parsed = UserSchema.safeParse(entry.user);
      if (parsed.success) {
        this.store.set(parsed.data.id, parsed.data);
      }
    } else if (entry.op === 'DEL') {
      this.store.delete(entry.id);
    } else if (entry.op === 'TX') {
      for (const sub of entry.ops) {
        this.applyEntryInMemory(sub);
      }
    }
  }

  private appendWal(entry: WalEntry): Promise<void> {
    const next = this.writeChain.then(async () => {
      if (!this.handle) {
        throw new Error('WalUserRepository is not initialized or already closed.');
      }
      await this.handle.write(`${JSON.stringify(entry)}\n`, null, 'utf8');
      await this.handle.datasync();
    });
    this.writeChain = next.catch(() => {});
    return next;
  }
}
