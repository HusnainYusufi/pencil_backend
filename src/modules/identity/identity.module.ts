import { Module } from '@nestjs/common';
import { UserSessionsRepository } from './user-sessions.repository.js';
import { UsersRepository } from './users.repository.js';

/** Global user accounts and their sessions (data access only). */
@Module({
  providers: [UsersRepository, UserSessionsRepository],
  exports: [UsersRepository, UserSessionsRepository],
})
export class IdentityModule {}
