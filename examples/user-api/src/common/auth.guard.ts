import {
  ForbiddenError,
  inject,
  Injectable,
  UnauthorizedError,
  type AuthGuard,
  type AuthGuardFn,
  type GuardContext,
} from 'better-back';
import { AppConfig } from '../config/env.js';

export interface AuthUser {
  readonly subject: string;
  readonly scopes: readonly string[];
}

@Injectable()
export class BearerAuthGuard implements AuthGuard<AuthUser> {
  private readonly config = inject(AppConfig);

  public canActivate({ req }: GuardContext): AuthUser {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer authorization header.');
    }

    const token = header.slice('Bearer '.length).trim();
    if (token !== this.config.API_BEARER_TOKEN) {
      throw new UnauthorizedError('Invalid Bearer token.');
    }

    return {
      subject: 'admin-operator',
      scopes: ['users:write', 'posts:write'],
    };
  }
}

/**
 * Downstream permission guard that inspects `ctx.user` resolved by `BearerAuthGuard`
 * (`@Guard(BearerAuthGuard, requireScope('users:write'))`).
 */
export function requireScope(scope: string): AuthGuardFn<void, AuthUser | undefined> {
  return ({ user }) => {
    if (!user) {
      throw new UnauthorizedError('Authentication required before checking scope.');
    }
    if (!user.scopes.includes(scope)) {
      throw new ForbiddenError(`Missing required permission scope "${scope}".`);
    }
  };
}
