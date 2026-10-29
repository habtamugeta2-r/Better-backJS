import { Controller, Delete, Get, Guard, inject, Patch, Post, type Ctx } from 'better-back';
import { BearerAuthGuard, requireScope, type AuthUser } from '../../common/auth.guard.js';
import {
  CreatePostSchema,
  PostIdParamsSchema,
  PostSchema,
  UpdatePostSchema,
} from './posts.schema.js';
import { PostsService } from './posts.service.js';

@Controller({ prefix: '/posts', tags: ['Posts'] })
export class PostsController {
  private readonly postsService = inject(PostsService);

  @Get('/', { summary: 'List all posts', response: PostSchema.array() })
  public list() {
    return this.postsService.listPosts();
  }

  @Get('/:id', {
    summary: 'Get post by UUID',
    params: PostIdParamsSchema,
    response: PostSchema,
    errors: [404],
  })
  public getById({ params }: Ctx<{ params: typeof PostIdParamsSchema }>) {
    return this.postsService.getPostById(params.id);
  }

  @Post('/', {
    summary: 'Create a new post (requires Bearer token + posts:write)',
    status: 201,
    body: CreatePostSchema,
    response: PostSchema,
    errors: [403, 404],
  })
  @Guard(BearerAuthGuard, requireScope('posts:write'))
  public create({ body, user, log }: Ctx<{ body: typeof CreatePostSchema; user: AuthUser }>) {
    log.info({ actor: user.subject, authorId: body.authorId }, 'creating post');
    return this.postsService.createPost(body);
  }

  @Patch('/:id', {
    summary: 'Update post title or content (requires Bearer token + posts:write)',
    params: PostIdParamsSchema,
    body: UpdatePostSchema,
    response: PostSchema,
    errors: [403, 404],
  })
  @Guard(BearerAuthGuard, requireScope('posts:write'))
  public update({
    params,
    body,
  }: Ctx<{ params: typeof PostIdParamsSchema; body: typeof UpdatePostSchema }>) {
    return this.postsService.updatePost(params.id, body);
  }

  @Delete('/:id', {
    summary: 'Delete post by UUID (requires Bearer token + posts:write)',
    status: 204,
    params: PostIdParamsSchema,
    errors: [403, 404],
  })
  @Guard(BearerAuthGuard, requireScope('posts:write'))
  public async remove({ params }: Ctx<{ params: typeof PostIdParamsSchema }>): Promise<void> {
    await this.postsService.deletePost(params.id);
  }
}
