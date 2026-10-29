import { Module } from 'better-back';
import { AuthModule } from '../../common/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { PostsController } from './posts.controller.js';
import { InMemoryPostRepository, PostRepositoryToken } from './posts.repository.js';
import { PostsService } from './posts.service.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [PostsController],
  providers: [{ provide: PostRepositoryToken, useClass: InMemoryPostRepository }, PostsService],
  exports: [PostsService, PostRepositoryToken],
})
export class PostsModule {}
