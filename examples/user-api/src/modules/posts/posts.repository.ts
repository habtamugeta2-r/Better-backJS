import { randomUUID } from 'node:crypto';
import { createToken, Injectable } from 'better-back';
import {
  PostIdSchema,
  PostSchema,
  type CreatePostInput,
  type PostId,
  type PostItem,
  type UpdatePostInput,
} from './posts.schema.js';

/**
 * Database-agnostic `PostRepository` port — swap `InMemoryPostRepository` for
 * PostgreSQL, Drizzle, Prisma, or SQLite via DI without touching `PostsService`.
 */
export interface PostRepository {
  findAll(): Promise<readonly PostItem[]>;
  findById(id: PostId): Promise<PostItem | undefined>;
  create(input: CreatePostInput): Promise<PostItem>;
  update(id: PostId, input: UpdatePostInput): Promise<PostItem | undefined>;
  delete(id: PostId): Promise<boolean>;
  ping(): Promise<boolean>;
}

export const PostRepositoryToken = createToken<PostRepository>('PostRepository');

@Injectable()
export class InMemoryPostRepository implements PostRepository {
  private readonly store = new Map<PostId, PostItem>();

  public async findAll(): Promise<readonly PostItem[]> {
    return [...this.store.values()];
  }

  public async findById(id: PostId): Promise<PostItem | undefined> {
    return this.store.get(id);
  }

  public async create(input: CreatePostInput): Promise<PostItem> {
    const id = PostIdSchema.parse(randomUUID());
    const post: PostItem = PostSchema.parse({
      id,
      authorId: input.authorId,
      title: input.title,
      content: input.content,
      createdAt: new Date().toISOString(),
    });
    this.store.set(id, post);
    return post;
  }

  public async update(id: PostId, input: UpdatePostInput): Promise<PostItem | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;

    const updated: PostItem = PostSchema.parse({
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    });
    this.store.set(id, updated);
    return updated;
  }

  public async delete(id: PostId): Promise<boolean> {
    return this.store.delete(id);
  }

  public async ping(): Promise<boolean> {
    return true;
  }
}
