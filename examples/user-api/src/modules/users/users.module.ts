import { inject, Module } from 'better-back';
import { AuthModule } from '../../common/auth.module.js';
import { AppConfig } from '../../config/env.js';
import { UsersController } from './users.controller.js';
import { InMemoryUserRepository, UserRepositoryToken } from './users.repository.js';
import { UsersService } from './users.service.js';
import { WalUserRepository } from './users.wal-repository.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    {
      provide: UserRepositoryToken,
      useFactory: () => {
        const cfg = inject(AppConfig);
        return cfg.USERS_WAL_PATH
          ? new WalUserRepository(cfg.USERS_WAL_PATH)
          : new InMemoryUserRepository();
      },
    },
    UsersService,
  ],
  exports: [UsersService, UserRepositoryToken],
})
export class UsersModule {}
