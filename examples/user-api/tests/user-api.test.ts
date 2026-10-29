import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ConflictError,
  createTestingApp,
  ForbiddenError,
  NotFoundError,
  resolveForTest,
} from 'better-back';
import { AppModule, buildUserApiOptions } from '../src/app.module.js';
import { requireScope } from '../src/common/auth.guard.js';
import { PostRepositoryToken, type PostRepository } from '../src/modules/posts/posts.repository.js';
import { PostIdSchema, type PostId, type PostItem } from '../src/modules/posts/posts.schema.js';
import { PostsService } from '../src/modules/posts/posts.service.js';
import { UserRepositoryToken, type UserRepository } from '../src/modules/users/users.repository.js';
import { UserIdSchema, type User, type UserId } from '../src/modules/users/users.schema.js';
import { UsersService } from '../src/modules/users/users.service.js';
import type { WalUserRepository } from '../src/modules/users/users.wal-repository.js';

const TEST_ENV = {
  NODE_ENV: 'test',
  API_BEARER_TOKEN: 'test-bearer-secret-token',
  CORS_ORIGIN: 'https://dashboard.better-back.dev',
};

const AUTH_HEADER = `Bearer ${TEST_ENV.API_BEARER_TOKEN}`;

describe('User API — Pure Domain Unit Tests (Zero HTTP Booted)', () => {
  it('tests UsersService in 1 line with resolveForTest() and a plain mock repository', async () => {
    const sampleId: UserId = UserIdSchema.parse('550e8400-e29b-41d4-a716-446655440000');
    const storedUser: User = {
      id: sampleId,
      email: 'ada@lovelace.org',
      name: 'Ada Lovelace',
      role: 'admin',
      createdAt: '2026-10-29T00:00:00.000Z',
    };

    const fakeRepo: UserRepository = {
      findMany: async () => ({ items: [storedUser], total: 1 }),
      findById: async (id) => (id === sampleId ? storedUser : undefined),
      findByEmail: async (email) => (email === storedUser.email ? storedUser : undefined),
      create: async (input) => ({
        id: sampleId,
        email: input.email,
        name: input.name,
        role: input.role,
        createdAt: storedUser.createdAt,
      }),
      update: async () => storedUser,
      delete: async (id) => id === sampleId,
      ping: async () => true,
    };

    const service = resolveForTest(UsersService, [[UserRepositoryToken, fakeRepo]]);
    const fetched = await service.getUserById(sampleId);
    expect(fetched.email).toBe('ada@lovelace.org');
    expectTypeOf(fetched.id).toEqualTypeOf<UserId>();

    await expect(
      service.createUser({ email: 'ada@lovelace.org', name: 'Duplicate', role: 'member' }),
    ).rejects.toThrowError(ConflictError);

    const missingId = UserIdSchema.parse('660e8400-e29b-41d4-a716-446655440001');
    await expect(service.getUserById(missingId)).rejects.toThrowError(NotFoundError);

    // Symmetrical 1-line unit test for PostsService via PostRepositoryToken
    const samplePostId: PostId = PostIdSchema.parse('880e8400-e29b-41d4-a716-446655440000');
    const samplePost: PostItem = {
      id: samplePostId,
      authorId: sampleId,
      title: 'Analytical Engine Notes',
      content: 'Note G',
      createdAt: '2026-10-29T00:00:00.000Z',
    };
    const fakePostRepo: PostRepository = {
      findAll: async () => [samplePost],
      findById: async (id) => (id === samplePostId ? samplePost : undefined),
      create: async () => samplePost,
      update: async () => samplePost,
      delete: async (id) => id === samplePostId,
      ping: async () => true,
    };

    const postsService = resolveForTest(PostsService, [
      [PostRepositoryToken, fakePostRepo],
      [UsersService, service],
    ]);
    expect((await postsService.getPostById(samplePostId)).title).toBe('Analytical Engine Notes');
  });
});

describe('User & Posts API — End-to-End HTTP Integration, Express Interop, WAL Persistence & DI Overrides', () => {
  it('completes full Users & Posts CRUD, pagination, chained auth guards, validation, and conflict handling', async () => {
    await using app = await createTestingApp(AppModule, buildUserApiOptions(TEST_ENV));

    // 1. Unauthorized POST without Bearer token or with wrong token -> 401 RFC 7807
    const unauthRes = await request(app.express)
      .post('/api/v1/users')
      .send({ email: 'grace@hopper.org', name: 'Grace Hopper' });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.headers['content-type']).toContain('application/problem+json');
    expect(unauthRes.body.code).toBe('UNAUTHORIZED');

    const wrongTokenRes = await request(app.express)
      .post('/api/v1/users')
      .set('Authorization', 'Bearer wrong-token')
      .send({ email: 'grace@hopper.org', name: 'Grace Hopper' });
    expect(wrongTokenRes.status).toBe(401);

    // 2. Validation failure -> 400 RFC 7807 with field issues
    const invalidRes = await request(app.express)
      .post('/api/v1/users')
      .set('Authorization', AUTH_HEADER)
      .send({ email: 'not-an-email', name: 'A' });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.code).toBe('VALIDATION_ERROR');
    expect(invalidRes.body.errors.length).toBeGreaterThanOrEqual(2);

    // 3. Create two users
    const createGrace = await request(app.express)
      .post('/api/v1/users')
      .set('Authorization', AUTH_HEADER)
      .send({ email: 'Grace@Hopper.org', name: 'Grace Hopper', role: 'admin' });
    expect(createGrace.status).toBe(201);
    expect(createGrace.headers['x-resource-domain']).toBe('users');
    expect(createGrace.body.email).toBe('grace@hopper.org');
    const graceId = createGrace.body.id as string;

    const createAlan = await request(app.express)
      .post('/api/v1/users')
      .set('Authorization', AUTH_HEADER)
      .send({ email: 'alan@turing.org', name: 'Alan Turing' });
    expect(createAlan.status).toBe(201);
    expect(createAlan.body.role).toBe('member');

    // 4. Duplicate email -> 409 Conflict Problem Details
    const dupRes = await request(app.express)
      .post('/api/v1/users')
      .set('Authorization', AUTH_HEADER)
      .send({ email: 'grace@hopper.org', name: 'Another Grace' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.code).toBe('CONFLICT');

    // 5. Paginated list & role filter
    const listPage1 = await request(app.express).get('/api/v1/users?page=1&limit=1&order=asc');
    expect(listPage1.status).toBe(200);
    expect(listPage1.body.data).toHaveLength(1);
    expect(listPage1.body.meta).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });

    // 6. Update user
    const patchRes = await request(app.express)
      .patch(`/api/v1/users/${graceId}`)
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Admiral Grace Hopper' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.name).toBe('Admiral Grace Hopper');

    // 7. Posts resource (unified decorator syntax) with cross-module author verification
    const badAuthorPost = await request(app.express)
      .post('/api/v1/posts')
      .set('Authorization', AUTH_HEADER)
      .send({
        authorId: '00000000-0000-4000-8000-000000000099',
        title: 'Compiler Design',
        content: 'A-0 System notes',
      });
    expect(badAuthorPost.status).toBe(404);

    const createPost = await request(app.express)
      .post('/api/v1/posts')
      .set('Authorization', AUTH_HEADER)
      .send({
        authorId: graceId,
        title: 'Compiler Design',
        content: 'A-0 System notes',
      });
    expect(createPost.status).toBe(201);
    const postId = createPost.body.id as string;

    const listPosts = await request(app.express).get('/api/v1/posts');
    expect(listPosts.status).toBe(200);
    expect(listPosts.body).toHaveLength(1);

    const getPost = await request(app.express).get(`/api/v1/posts/${postId}`);
    expect(getPost.status).toBe(200);
    expect(getPost.body.title).toBe('Compiler Design');

    const patchPost = await request(app.express)
      .patch(`/api/v1/posts/${postId}`)
      .set('Authorization', AUTH_HEADER)
      .send({ title: 'Modern Compiler Design' });
    expect(patchPost.status).toBe(200);
    expect(patchPost.body.title).toBe('Modern Compiler Design');

    const deletePost = await request(app.express)
      .delete(`/api/v1/posts/${postId}`)
      .set('Authorization', AUTH_HEADER);
    expect(deletePost.status).toBe(204);

    // 8. Delete user & verify 404 after deletion
    const deleteGrace = await request(app.express)
      .delete(`/api/v1/users/${graceId}`)
      .set('Authorization', AUTH_HEADER);
    expect(deleteGrace.status).toBe(204);

    const getDeleted = await request(app.express).get(`/api/v1/users/${graceId}`);
    expect(getDeleted.status).toBe(404);
    expect(getDeleted.body.code).toBe('NOT_FOUND');

    // 9. Unknown route -> 404 RFC 7807
    const unknownRoute = await request(app.express).get('/api/v1/unknown-endpoint');
    expect(unknownRoute.status).toBe(404);
    expect(unknownRoute.body.code).toBe('NOT_FOUND');
  });

  it('proves native Express cors/helmet/morgan interop, raw Express setup escape hatch, and hoisted OpenAPI 3.1 components', async () => {
    const baseOpts = buildUserApiOptions(TEST_ENV);
    await using app = await createTestingApp(AppModule, {
      ...baseOpts,
      setup: (rawExpress, container) => {
        baseOpts.setup?.(rawExpress, container);
        rawExpress.get('/dynamic-escape', (_req, res) => {
          res.status(200).json({ dynamic: true });
        });
      },
    });

    const escape1 = await request(app.express)
      .get('/raw-express-ping')
      .set('Origin', 'https://dashboard.better-back.dev');
    expect(escape1.status).toBe(200);
    expect(escape1.body).toEqual({ source: 'raw-express-escape-hatch', ok: true });
    expect(escape1.headers['access-control-allow-origin']).toBe(
      'https://dashboard.better-back.dev',
    );
    expect(escape1.headers['x-dns-prefetch-control']).toBeDefined();
    expect(escape1.headers['x-request-id']).toBeDefined();

    const escape2 = await request(app.express).get('/dynamic-escape');
    expect(escape2.status).toBe(200);
    expect(escape2.body).toEqual({ dynamic: true });

    const rootJson = await request(app.express).get('/').set('Accept', 'application/json');
    expect(rootJson.status).toBe(200);
    expect(rootJson.body.docs).toBe('/docs');

    const rootHtml = await request(app.express).get('/').set('Accept', 'text/html');
    expect(rootHtml.status).toBe(302);
    expect(rootHtml.headers['location']).toBe('/docs');

    const ready = await request(app.express).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');

    const docs = await request(app.express).get('/docs/openapi.json');
    expect(docs.status).toBe(200);
    expect(docs.body.openapi).toBe('3.1.0');
    expect(docs.body.paths['/api/v1/users']).toBeDefined();
    expect(docs.body.paths['/api/v1/users/{id}']).toBeDefined();
    expect(docs.body.paths['/api/v1/posts']).toBeDefined();
    expect(docs.body.paths['/api/v1/posts/{id}']).toBeDefined();
    expect(docs.body.components.securitySchemes.bearerAuth).toBeDefined();

    // Verify hoisted component schemas ($ref) & documented domain error codes (404 / 409)
    expect(docs.body.components.schemas.User).toBeDefined();
    expect(docs.body.components.schemas.CreateUserInput).toBeDefined();
    expect(docs.body.components.schemas.PaginatedUsersResponse).toBeDefined();
    expect(docs.body.components.schemas.Post).toBeDefined();
    expect(
      docs.body.paths['/api/v1/users'].post.responses['201'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/User' });
    expect(docs.body.paths['/api/v1/users'].post.responses['409']).toBeDefined();
    expect(docs.body.paths['/api/v1/users/{id}'].get.responses['404']).toBeDefined();
  });

  it('supports one-line DI repository mocking across the full HTTP stack without monkey-patching', async () => {
    const cannedId = UserIdSchema.parse('770e8400-e29b-41d4-a716-446655440000');
    const mockRepo: UserRepository = {
      findMany: async () => ({
        items: [
          {
            id: cannedId,
            email: 'mocked@better-back.dev',
            name: 'One-Line Override',
            role: 'admin',
            createdAt: '2026-10-29T09:00:00.000Z',
          },
        ],
        total: 1,
      }),
      findById: async () => undefined,
      findByEmail: async () => undefined,
      create: async () => {
        throw new Error('not called');
      },
      update: async () => undefined,
      delete: async () => false,
      ping: async () => true,
    };

    await using app = await createTestingApp(AppModule, {
      ...buildUserApiOptions(TEST_ENV),
      overrides: [[UserRepositoryToken, mockRepo]],
    });

    const res = await request(app.express).get('/api/v1/users');
    expect(res.status).toBe(200);
    expect(res.body.data[0].email).toBe('mocked@better-back.dev');
  });

  it('proves real disk durability, OnModuleInit/OnApplicationShutdown lifecycle, and transactional rollback via WalUserRepository', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'better-back-wal-'));
    const walPath = path.join(tmpDir, 'users.wal.jsonl');
    const walEnv = { ...TEST_ENV, USERS_WAL_PATH: walPath };

    try {
      // 1. Boot Instance #1 -> `onModuleInit()` opens WAL file handle
      const app1 = await createTestingApp(AppModule, buildUserApiOptions(walEnv));
      const repo1 = app1.container.resolve(UserRepositoryToken, 'UsersModule') as WalUserRepository;
      expect(repo1.isOpen).toBe(true);
      expect((await request(app1.express).get('/ready')).status).toBe(200);

      // Create durable user via HTTP POST
      const created = await request(app1.express)
        .post('/api/v1/users')
        .set('Authorization', AUTH_HEADER)
        .send({ email: 'barbara@liskov.org', name: 'Barbara Liskov', role: 'admin' });
      expect(created.status).toBe(201);

      // Verify atomic transaction rollback discards partial writes on error!
      await expect(
        repo1.withTransaction(async (tx) => {
          await tx.create({ email: 'rolledback@example.com', name: 'Rolled Back', role: 'member' });
          throw new Error('Simulated mid-transaction failure');
        }),
      ).rejects.toThrow(/Simulated mid-transaction failure/);

      expect(await repo1.findByEmail('rolledback@example.com')).toBeUndefined();

      // Verify committed multi-op transaction persists atomically!
      await repo1.withTransaction(async (tx) => {
        const tempUser = await tx.create({
          email: 'ephemeral@example.com',
          name: 'Ephemeral User',
          role: 'viewer',
        });
        await tx.delete(tempUser.id);
        await tx.create({ email: 'leslie@lamport.org', name: 'Leslie Lamport', role: 'member' });
      });

      // Verify update & delete through HTTP against WalUserRepository
      const patchBarbara = await request(app1.express)
        .patch(`/api/v1/users/${created.body.id as string}`)
        .set('Authorization', AUTH_HEADER)
        .send({ name: 'Prof. Barbara Liskov' });
      expect(patchBarbara.status).toBe(200);

      // Verify `requireScope` throws ForbiddenError when scope is missing
      const checkBillingScope = requireScope('billing:admin');
      expect(() =>
        checkBillingScope({
          req: {} as never,
          res: {} as never,
          requestId: 'req-test-1',
          signal: new AbortController().signal,
          log: {} as never,
          user: { subject: 'op', scopes: ['users:write'] },
        }),
      ).toThrowError(ForbiddenError);

      // Shutdown Instance #1 -> `onApplicationShutdown()` flushes & closes `FileHandle`
      await app1.close('SIGTERM');
      expect(repo1.isOpen).toBe(false);

      // Simulate an incomplete/torn trailing WAL line from sudden power loss
      await appendFile(walPath, '{"op":"PUT","user":{"truncated":', 'utf8');

      // 2. Boot Instance #2 against the SAME WAL file -> `onModuleInit()` replays WAL cleanly!
      await using app2 = await createTestingApp(AppModule, buildUserApiOptions(walEnv));
      const listAfterRestart = await request(app2.express).get('/api/v1/users');
      expect(listAfterRestart.status).toBe(200);
      expect(listAfterRestart.body.meta.total).toBe(2);
      const usersAfterRestart = listAfterRestart.body.data as User[];
      expect(usersAfterRestart.map((u) => u.email).sort()).toEqual([
        'barbara@liskov.org',
        'leslie@lamport.org',
      ]);
      expect(usersAfterRestart.find((u) => u.email === 'barbara@liskov.org')?.name).toBe(
        'Prof. Barbara Liskov',
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
