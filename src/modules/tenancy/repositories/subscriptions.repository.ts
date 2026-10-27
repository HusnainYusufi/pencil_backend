import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../../core/database/base.repository.js';
import type { Prisma, Subscription } from '../../../generated/prisma/client.js';

@Injectable()
export class SubscriptionsRepository extends BaseRepository {
  findByTenant(tenantId: string): Promise<Subscription | null> {
    return this.client.subscription.findUnique({ where: { tenantId } });
  }

  create(data: Prisma.SubscriptionUncheckedCreateInput): Promise<Subscription> {
    return this.client.subscription.create({ data });
  }

  update(tenantId: string, data: Prisma.SubscriptionUncheckedUpdateInput): Promise<Subscription> {
    return this.client.subscription.update({ where: { tenantId }, data });
  }
}
