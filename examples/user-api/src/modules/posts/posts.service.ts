import { inject, Injectable, NotFoundError } from 'better-back';
import { UsersService } from '../users/users.service.js';
import { PostRepositoryToken } from './posts.repository.js';
import type { CreatePostInput, PostId, PostItem, UpdatePostInput } from './posts.schema.js';

/**
 * Pure domain service for Posts — zero HTTP/Express imports and zero database driver coupling.
 */
@Injectable()
export class PostsService {
  private readonly repo = inject(PostRepositoryToken);
  private readonly users = inject(UsersService);

  public async listPosts(): Promise<readonly PostItem[]> {
    return this.repo.findAll();
  }

  public async getPostById(id: PostId): Promise<PostItem> {
    const post = await this.repo.findById(id);
    if (!post) {
      throw new NotFoundError(`Post "${id}" was not found.`);
    }
    return post;
  }

  public async createPost(input: CreatePostInput): Promise<PostItem> {
    await this.users.getUserById(input.authorId);
    return this.repo.create(input);
  }

  public async updatePost(id: PostId, input: UpdatePostInput): Promise<PostItem> {
    const updated = await this.repo.update(id, input);
    if (!updated) {
      throw new NotFoundError(`Post "${id}" was not found.`);
    }
    return updated;
  }

  public async deletePost(id: PostId): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) {
      throw new NotFoundError(`Post "${id}" was not found.`);
    }
  }
}
