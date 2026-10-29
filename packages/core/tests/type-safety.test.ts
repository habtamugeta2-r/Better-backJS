import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  Controller,
  ForbiddenError,
  Get,
  Guard,
  Post,
  type Ctx,
  type GuardContext,
} from 'better-back';

const BrandedUserId = z.uuid().brand<'UserId'>();
type UserId = z.output<typeof BrandedUserId>;

const CreateAccountSchema = z.object({
  email: z.email(),
  age: z.number().int().min(18),
});

const AccountQuerySchema = z.object({
  dryRun: z.coerce.boolean().default(false),
});

const AccountSchema = z.object({
  id: BrandedUserId,
  email: z.email(),
  age: z.number().int(),
});

interface SessionUser {
  readonly actorId: UserId;
  readonly role: 'admin' | 'member';
}

const sessionGuard = (): SessionUser => ({
  actorId: BrandedUserId.parse('550e8400-e29b-41d4-a716-446655440000'),
  role: 'admin',
});

const adminOnlyGuard = ({ user }: GuardContext<SessionUser>): void => {
  if (user.role !== 'admin') {
    throw new ForbiddenError('Admin role required.');
  }
};

describe('Compile-Time Type Inference & Schema/Guard Drift Protection', () => {
  it('infers route params, Zod DTOs, branded IDs, and chained @Guard user types via Ctx<...>', () => {
    @Controller('/orgs')
    class AccountsController {
      @Post('/:orgId/accounts/:accountId', {
        body: CreateAccountSchema,
        query: AccountQuerySchema,
        response: AccountSchema,
        errors: [403, 404, 409],
      })
      @Guard(sessionGuard, adminOnlyGuard)
      public create({
        params,
        body,
        query,
        user,
      }: Ctx<{
        params: '/:orgId/accounts/:accountId';
        body: typeof CreateAccountSchema;
        query: typeof AccountQuerySchema;
        user: SessionUser;
      }>) {
        expectTypeOf(params).toEqualTypeOf<{
          readonly orgId: string;
          readonly accountId: string;
        }>();
        expectTypeOf(body).toEqualTypeOf<{ email: string; age: number }>();
        expectTypeOf(query).toEqualTypeOf<{ dryRun: boolean }>();
        expectTypeOf(user).toEqualTypeOf<SessionUser>();

        // @ts-expect-error — accessing an undeclared DTO field MUST fail compilation
        void body.nonExistentField;

        // @ts-expect-error — accessing an undeclared route param MUST fail compilation
        void params.wrongParam;

        return {
          id: user.actorId,
          email: body.email,
          age: body.age,
        };
      }

      // Supports concise path shorthand `Ctx<'/:id'>` and body shorthand `Ctx<typeof CreateAccountSchema>`
      @Get('/by-slug/:slug')
      public getBySlug({ params }: Ctx<'/by-slug/:slug'>) {
        expectTypeOf(params).toEqualTypeOf<{ readonly slug: string }>();
        return { slug: params.slug };
      }

      // Guarded route that does not read `user` does NOT need to repeat `user` in `Ctx<typeof CreateAccountSchema>`!
      @Post('/quick', { body: CreateAccountSchema })
      @Guard(sessionGuard)
      public quickCreate({ body }: Ctx<typeof CreateAccountSchema>) {
        expectTypeOf(body).toEqualTypeOf<{ email: string; age: number }>();
        return { email: body.email };
      }

      @Get('/bad-user-claim')
      // @ts-expect-error — mismatched `user` type (`{ wrongClaim: number }`) vs `sessionGuard` (`SessionUser`) MUST fail compilation!
      @Guard(sessionGuard)
      public mismatchedGuardUser({ user }: Ctx<{ user: { wrongClaim: number } }>) {
        return { claim: user.wrongClaim };
      }

      // @ts-expect-error — mismatched `Ctx<'/:typoId'>` vs `@Get('/:accountId')` MUST fail compilation!
      @Get('/:accountId')
      public mismatchedParam({ params }: Ctx<'/:typoId'>) {
        return { id: params.typoId };
      }

      // @ts-expect-error — returning `{ wrong: true }` violates `response: AccountSchema`!
      @Get('/check/:accountId', { response: AccountSchema })
      public brokenHandler() {
        return { wrong: true };
      }
    }

    expectTypeOf(AccountsController).toBeConstructibleWith();
  });
});
