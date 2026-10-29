import { Module } from 'better-back';
import { BearerAuthGuard } from './auth.guard.js';

@Module({
  providers: [BearerAuthGuard],
  exports: [BearerAuthGuard],
})
export class AuthModule {}
