import { Module } from '@nestjs/common';
import { AccountLinksService } from './account-links.service.js';
import { UserSessionsRepository } from './user-sessions.repository.js';
import { UserTokensRepository } from './user-tokens.repository.js';
import { UsersRepository } from './users.repository.js';

/** Global user accounts, their sessions and emailed account links. */
@Module({
  providers: [UsersRepository, UserSessionsRepository, UserTokensRepository, AccountLinksService],
  exports: [UsersRepository, UserSessionsRepository, UserTokensRepository, AccountLinksService],
})
export class IdentityModule {}
