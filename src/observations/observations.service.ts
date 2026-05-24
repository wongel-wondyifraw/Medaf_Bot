import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BroadGroup } from '../calculator/broad-group';
import { AedObservation } from './observation.entity';

export type PriceConfidence = 'high' | 'medium' | 'low' | 'estimate';

export interface HistoryLookup {
  factor: number;
  confidence: PriceConfidence;
  source: 'product' | 'category' | 'group';
}

export interface RecordObservationInput {
  productId: string;
  productLink: string;
  categoryName: string;
  broadGroup: BroadGroup;
  ethUsd: number;
  aedPrice: number;
  usdToAed: number;
}

@Injectable()
export class ObservationsService {
  private readonly logger = new Logger(ObservationsService.name);

  constructor(
    @InjectRepository(AedObservation)
    private readonly repo: Repository<AedObservation>,
  ) {}

  async recordObservation(input: RecordObservationInput): Promise<AedObservation> {
    const dubaiUsdImplied = input.aedPrice / input.usdToAed;
    const factorImplied =
      input.ethUsd > 0 ? dubaiUsdImplied / input.ethUsd : 1;

    const row = await this.repo.save({
      productId: input.productId,
      productLink: input.productLink,
      categoryName: input.categoryName,
      broadGroup: input.broadGroup,
      ethUsd: input.ethUsd,
      aedPrice: input.aedPrice,
      usdToAedAtObs: input.usdToAed,
      dubaiUsdImplied,
      factorImplied,
    });

    this.logger.log(
      `Observation #${row.id} product=${input.productId} factor=${factorImplied.toFixed(4)}`,
    );
    return row;
  }

  async lookup(
    productId: string | null,
    categoryName: string | null,
    broadGroup: BroadGroup,
  ): Promise<HistoryLookup | null> {
    if (productId) {
      const count = await this.countByProduct(productId);
      if (count >= 5) {
        const factor = await this.avgFactorByProduct(productId);
        if (factor != null) {
          return { factor, confidence: 'high', source: 'product' };
        }
      }
    }

    if (categoryName) {
      const count = await this.countByCategory(categoryName);
      if (count >= 10) {
        const factor = await this.avgFactorByCategory(categoryName);
        if (factor != null) {
          return { factor, confidence: 'medium', source: 'category' };
        }
      }
    }

    const groupCount = await this.countByGroup(broadGroup);
    if (groupCount >= 3) {
      const factor = await this.avgFactorByGroup(broadGroup);
      if (factor != null) {
        return { factor, confidence: 'low', source: 'group' };
      }
    }

    return null;
  }

  async countByProduct(productId: string): Promise<number> {
    return this.repo.count({ where: { productId } });
  }

  async avgFactorByProduct(productId: string): Promise<number | null> {
    const row = await this.repo
      .createQueryBuilder('o')
      .select('AVG(o.factor_implied)', 'avg')
      .where('o.product_id = :productId', { productId })
      .getRawOne<{ avg: string | null }>();
    return this.parseAvg(row?.avg);
  }

  async avgEthUsdByProduct(productId: string): Promise<number | null> {
    const row = await this.repo
      .createQueryBuilder('o')
      .select('AVG(o.eth_usd)', 'avg')
      .where('o.product_id = :productId', { productId })
      .getRawOne<{ avg: string | null }>();
    return this.parseAvg(row?.avg);
  }

  async countByCategory(categoryName: string): Promise<number> {
    return this.repo.count({ where: { categoryName } });
  }

  async avgFactorByCategory(categoryName: string): Promise<number | null> {
    const row = await this.repo
      .createQueryBuilder('o')
      .select('AVG(o.factor_implied)', 'avg')
      .where('o.category_name = :categoryName', { categoryName })
      .getRawOne<{ avg: string | null }>();
    return this.parseAvg(row?.avg);
  }

  async countByGroup(broadGroup: BroadGroup): Promise<number> {
    return this.repo.count({ where: { broadGroup } });
  }

  async avgFactorByGroup(broadGroup: BroadGroup): Promise<number | null> {
    const row = await this.repo
      .createQueryBuilder('o')
      .select('AVG(o.factor_implied)', 'avg')
      .where('o.broad_group = :broadGroup', { broadGroup })
      .getRawOne<{ avg: string | null }>();
    return this.parseAvg(row?.avg);
  }

  private parseAvg(raw: string | null | undefined): number | null {
    if (raw == null) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
}
