import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base.repository.js';
import type { Feature, Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class FeaturesRepository extends BaseRepository {
  list(): Promise<Feature[]> {
    return this.client.feature.findMany({ orderBy: { key: 'asc' } });
  }

  findByKey(key: string): Promise<Feature | null> {
    return this.client.feature.findUnique({ where: { key } });
  }

  async findByKeys(keys: readonly string[]): Promise<Feature[]> {
    if (keys.length === 0) return [];
    return this.client.feature.findMany({ where: { key: { in: [...keys] } } });
  }

  create(data: Prisma.FeatureCreateInput): Promise<Feature> {
    return this.client.feature.create({ data });
  }

  update(key: string, data: Prisma.FeatureUpdateInput): Promise<Feature> {
    return this.client.feature.update({ where: { key }, data });
  }
}
