import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import {
  HistoryLookup,
  ObservationsService,
  PriceConfidence,
} from '../observations/observations.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import {
  BroadGroup,
  defaultDubaiFactorForGroup,
  resolveBroadGroup,
} from './broad-group';

export interface DubaiEstimateInput {
  ethUsd: number;
  productId: string | null;
  categoryName: string | null;
  /** When set, skip history/criteria and use this factor directly. */
  forceFactor?: number;
}

export interface DubaiEstimateResult {
  dubaiUsd: number;
  dubaiAed: number;
  factorUsed: number;
  confidence: PriceConfidence;
  triggers: string[];
  history: HistoryLookup | null;
}

const BRACKET_FACTOR = 0.65;
const BRACKET_USD_THRESHOLD = 60;
const RATIO_TRIGGER_MULTIPLIER = 1.2;
const HISTORY_DEVIATION_MULTIPLIER = 1.25;

@Injectable()
export class DubaiEstimatorService {
  constructor(
    private readonly observations: ObservationsService,
    private readonly categories: CategoriesService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async estimate(input: DubaiEstimateInput): Promise<DubaiEstimateResult> {
    const usdToAed = await this.resolveUsdToAed();

    if (
      input.forceFactor != null &&
      Number.isFinite(input.forceFactor) &&
      input.forceFactor > 0
    ) {
      const factorUsed = input.forceFactor;
      const dubaiUsd = input.ethUsd * factorUsed;
      return {
        dubaiUsd,
        dubaiAed: dubaiUsd * usdToAed,
        factorUsed,
        confidence: 'estimate',
        triggers: ['forced'],
        history: null,
      };
    }

    const broadGroup = resolveBroadGroup(input.categoryName);
    const categoryFactor = await this.resolveCategoryFactor(
      input.categoryName,
      broadGroup,
    );

    const history = await this.observations.lookup(
      input.productId,
      input.categoryName,
      broadGroup,
    );

    const criteria = await this.runCriteriaTriggers(
      input.ethUsd,
      input.productId,
      categoryFactor,
    );

    const { factorUsed, confidence, triggers } = this.combineSources(
      history,
      criteria,
      categoryFactor,
      broadGroup,
    );

    const dubaiUsd = input.ethUsd * factorUsed;
    const dubaiAed = dubaiUsd * usdToAed;

    return {
      dubaiUsd,
      dubaiAed,
      factorUsed,
      confidence,
      triggers,
      history,
    };
  }

  async resolveUsdToAed(): Promise<number> {
    const pricing = this.config.get('pricing', { infer: true });
    const db = await this.settings.getNumber(SETTING_KEYS.USD_TO_AED, 0);
    const rate = db > 0 ? db : pricing.usdToAed ?? 3.67;
    return rate;
  }

  private async resolveCategoryFactor(
    categoryName: string | null,
    broadGroup: BroadGroup,
  ): Promise<number> {
    if (categoryName) {
      const category = await this.categories.findByName(categoryName);
      if (category?.dubaiFactor != null && category.dubaiFactor > 0) {
        return category.dubaiFactor;
      }
    }
    return defaultDubaiFactorForGroup(broadGroup);
  }

  private async runCriteriaTriggers(
    ethUsd: number,
    productId: string | null,
    categoryFactor: number,
  ): Promise<{ factor: number | null; triggers: string[] }> {
    const triggeredFactors: number[] = [];
    const triggers: string[] = [];

    const expectedDubaiUsd = ethUsd * categoryFactor;
    if (ethUsd > expectedDubaiUsd * RATIO_TRIGGER_MULTIPLIER) {
      triggeredFactors.push(categoryFactor);
      triggers.push('ratio');
    }

    if (ethUsd > BRACKET_USD_THRESHOLD) {
      triggeredFactors.push(BRACKET_FACTOR);
      triggers.push('bracket');
    }

    if (productId) {
      const avgEth = await this.observations.avgEthUsdByProduct(productId);
      const productFactor = await this.observations.avgFactorByProduct(productId);
      if (
        avgEth != null &&
        avgEth > 0 &&
        productFactor != null &&
        ethUsd >= avgEth * HISTORY_DEVIATION_MULTIPLIER
      ) {
        triggeredFactors.push(productFactor);
        triggers.push('history');
      }
    }

    if (!triggeredFactors.length) {
      return { factor: null, triggers: [] };
    }

    const factor =
      triggeredFactors.reduce((a, b) => a + b, 0) / triggeredFactors.length;
    return { factor, triggers };
  }

  private combineSources(
    history: HistoryLookup | null,
    criteria: { factor: number | null; triggers: string[] },
    categoryFactor: number,
    broadGroup: BroadGroup,
  ): {
    factorUsed: number;
    confidence: PriceConfidence;
    triggers: string[];
  } {
    const triggers = [...criteria.triggers];
    if (history) {
      triggers.push(`history:${history.source}`);
    }

    if (history && criteria.factor != null) {
      return {
        factorUsed: (history.factor + criteria.factor) / 2,
        confidence: history.confidence,
        triggers,
      };
    }

    if (history) {
      return {
        factorUsed: history.factor,
        confidence: history.confidence,
        triggers,
      };
    }

    if (criteria.factor != null) {
      return {
        factorUsed: criteria.factor,
        confidence: 'estimate',
        triggers,
      };
    }

    return {
      factorUsed: 1,
      confidence: 'estimate',
      triggers: triggers.length ? triggers : ['none'],
    };
  }

  formatConfidence(confidence: PriceConfidence): string {
    switch (confidence) {
      case 'high':
        return 'High';
      case 'medium':
        return 'Medium';
      case 'low':
        return 'Low';
      default:
        return 'Estimate';
    }
  }
}
