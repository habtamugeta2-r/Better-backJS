import {
  ConflictError,
  inject,
  Injectable,
  NotFoundError,
  paginate,
  type PaginatedResult,
} from 'better-back';
import { UserRepositoryToken } from './users.repository.js';
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
  User,
  UserId,
} from './users.schema.js';

/**
 * Pure TypeScript domain service — ZERO Express or HTTP transport imports.
 * Directly unit-testable with `resolveForTest(UsersService, [[UserRepositoryToken, mockRepo]])`
 * and zero HTTP server booted.
 */
@Injectable()
export class UsersService {
  private readonly usersRepo = inject(UserRepositoryToken);

  public async listUsers(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    const { items, total } = await this.usersRepo.findMany(query);
    return paginate(items, total, query);
  }

  public async getUserById(id: UserId): Promise<User> {
    const user = await this.usersRepo.findById(id);
    if (!user) {
      throw new NotFoundError(`User "${id}" was not found.`);
    }
    return user;
  }

  public async createUser(input: CreateUserInput): Promise<User> {
    const duplicate = await this.usersRepo.findByEmail(input.email);
    if (duplicate) {
      throw new ConflictError(`A user with email "${input.email}" already exists.`);
    }
    return this.usersRepo.create(input);
  }

  public async updateUser(id: UserId, input: UpdateUserInput): Promise<User> {
    if (input.email) {
      const duplicate = await this.usersRepo.findByEmail(input.email);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError(`A user with email "${input.email}" already exists.`);
      }
    }

    const updated = await this.usersRepo.update(id, input);
    if (!updated) {
      throw new NotFoundError(`User "${id}" was not found.`);
    }
    return updated;
  }

  public async deleteUser(id: UserId): Promise<void> {
    const deleted = await this.usersRepo.delete(id);
    if (!deleted) {
      throw new NotFoundError(`User "${id}" was not found.`);
    }
  }
}
