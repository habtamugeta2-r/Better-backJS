import type { RequestHandler } from 'express';
import { Controller, Delete, Get, Guard, inject, Patch, Post, Use, type Ctx } from 'better-back';
import { BearerAuthGuard, requireScope, type AuthUser } from '../../common/auth.guard.js';
import {
  CreateUserSchema,
  ListUsersQuerySchema,
  PaginatedUsersResponseSchema,
  UpdateUserSchema,
  UserIdParamsSchema,
  UserSchema,
} from './users.schema.js';
import { UsersService } from './users.service.js';

/** Native Express middleware mounted directly on UsersController with zero adapters. */
const usersAuditHeaderMiddleware: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Resource-Domain', 'users');
  next();
};

@Controller({ prefix: '/users', tags: ['Users'] })
@Use(usersAuditHeaderMiddleware)
export class UsersController {
  private readonly usersService = inject(UsersService);

  @Get('/', {
    summary: 'List users with pagination',
    query: ListUsersQuerySchema,
    response: PaginatedUsersResponseSchema,
  })
  public list({ query }: Ctx<{ query: typeof ListUsersQuerySchema }>) {
    return this.usersService.listUsers(query);
  }

  @Get('/:id', {
    summary: 'Get user by UUID',
    params: UserIdParamsSchema,
    response: UserSchema,
    errors: [404],
  })
  public getById({ params }: Ctx<{ params: typeof UserIdParamsSchema }>) {
    return this.usersService.getUserById(params.id);
  }

  @Post('/', {
    summary: 'Create a new user (requires Bearer token + users:write)',
    status: 201,
    body: CreateUserSchema,
    response: UserSchema,
    errors: [403, 409],
  })
  @Guard(BearerAuthGuard, requireScope('users:write'))
  public create({ body, user, log }: Ctx<{ body: typeof CreateUserSchema; user: AuthUser }>) {
    log.info({ actor: user.subject, email: body.email }, 'creating user');
    return this.usersService.createUser(body);
  }

  @Patch('/:id', {
    summary: 'Update user fields (requires Bearer token + users:write)',
    params: UserIdParamsSchema,
    body: UpdateUserSchema,
    response: UserSchema,
    errors: [403, 404, 409],
  })
  @Guard(BearerAuthGuard, requireScope('users:write'))
  public update({
    params,
    body,
  }: Ctx<{ params: typeof UserIdParamsSchema; body: typeof UpdateUserSchema }>) {
    return this.usersService.updateUser(params.id, body);
  }

  @Delete('/:id', {
    summary: 'Delete user by UUID (requires Bearer token + users:write)',
    status: 204,
    params: UserIdParamsSchema,
    errors: [403, 404],
  })
  @Guard(BearerAuthGuard, requireScope('users:write'))
  public async remove({ params }: Ctx<{ params: typeof UserIdParamsSchema }>): Promise<void> {
    await this.usersService.deleteUser(params.id);
  }
}
