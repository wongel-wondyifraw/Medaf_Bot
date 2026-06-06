import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import { PriceConfidence } from '../observations/observations.service';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import { DubaiEstimatorService } from './dubai-estimator.service';
import {
  applyLaw1Pricing,
  resolveDynamicMarginPercent,
  resolveEffectiveRescueFactor,
} from './pricing-math';

export { resolveDynamicMarginPercent } from './pricing-math';

export const DEFAULT_DELIVERY_ETB = 500;

export interface OrderTotal {
  totalEtb: number;
  sellingEtb: number;
  /** Per-unit final ETB (margin on Dubai cost + delivery). */
  unitEtbPerUnit: number;
  deliveryEtb: number;
  marginPercent: number;
  rateUsed: number;
  fromCurrency: string;
  matchedCategory: string | null;
  scrapedUnitUsd: number | null;
  effectiveUnitUsd: number | null;
  dubaiUsd: number;
  dubaiAed: number;
  factorUsed: number;
  confidence: PriceConfidence;
  triggers: string[];
}

export interface CalculateOptions {
  overrideUnitUsd?: number;
  quantity?: number;
  productId?: string | null;
  categoryName?: string | null;
}

export interface PriceFromEthUsdInput {
  ethUsd: number;
  productId: string | null;
  categoryName: string | null;
  deliveryEtb: number;
  quantity: number;
}

/**
 * Pulls the USD unit price out of a scraped product.
 */
export function extractScrapedUsd(product: ScrapedProduct): number | null {
  if (typeof product.priceUsd === 'number' && product.priceUsd > 0) {
    return product.priceUsd;
  }
  const currency = (product.currency || '').toUpperCase();
  if (currency === 'USD' && product.price > 0) return product.price;
  return null;
}

@Injectable()
export class CalculatorService {
  private readonly logger = new Logger(CalculatorService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: SettingsService,
    private readonly categoriesService: CategoriesService,
    private readonly dubaiEstimator: DubaiEstimatorService,
  ) {}

  async resolveDelivery(
    product: ScrapedProduct,
  ): Promise<{ deliveryEtb: number; matchedCategory: string | null }> {
    const categoryMatch = await this.resolveCategoryShipping(product);
    const delivery = categoryMatch ? categoryMatch.shippingEtb : DEFAULT_DELIVERY_ETB;
    return {
      deliveryEtb: Math.round(delivery),
      matchedCategory: categoryMatch?.name ?? null,
    };
  }

  async priceFromEthUsd(input: PriceFromEthUsdInput): Promise<OrderTotal> {
    const rate = await this.resolveUsdToEtb();
    if (!rate) {
      throw new Error(
        'No ETB exchange rate configured. Set USD_TO_ETB from the admin panel or in .env.',
      );
    }

    const floorPerUnitEtb = input.ethUsd * rate;

    let estimate = await this.dubaiEstimator.estimate({
      ethUsd: input.ethUsd,
      productId: input.productId,
      categoryName: input.categoryName,
    });

    let triggers = [...estimate.triggers];

    let dubaiCostEtb = estimate.dubaiUsd * rate;
    let law1 = applyLaw1Pricing({
      dubaiCostEtb,
      deliveryEtb: input.deliveryEtb,
      quantity: input.quantity,
    });

    if (law1.finalEtbPerUnit < floorPerUnitEtb) {
      const cat = input.categoryName
        ? await this.categoriesService.findByName(input.categoryName)
        : null;
      const highFactor =
        cat?.dubaiFactorHigh != null && cat.dubaiFactorHigh > 0
          ? cat.dubaiFactorHigh
          : 1.0;
      const effectiveFactor = resolveEffectiveRescueFactor(highFactor);

      estimate = await this.dubaiEstimator.estimate({
        ethUsd: input.ethUsd,
        productId: input.productId,
        categoryName: input.categoryName,
        forceFactor: effectiveFactor,
      });
      dubaiCostEtb = estimate.dubaiUsd * rate;
      law1 = applyLaw1Pricing({
        dubaiCostEtb,
        deliveryEtb: input.deliveryEtb,
        quantity: input.quantity,
      });
      triggers.push('floor');
    }

    const unitEtbPerUnit = Math.ceil(law1.finalEtbPerUnit);

    return {
      totalEtb: law1.totalEtb,
      sellingEtb: law1.totalEtb,
      unitEtbPerUnit,
      deliveryEtb: input.deliveryEtb,
      marginPercent: law1.marginPercent,
      rateUsed: rate,
      fromCurrency: 'USD',
      matchedCategory: input.categoryName,
      scrapedUnitUsd: null,
      effectiveUnitUsd: input.ethUsd,
      dubaiUsd: estimate.dubaiUsd,
      dubaiAed: estimate.dubaiAed,
      factorUsed: estimate.factorUsed,
      confidence: estimate.confidence,
      triggers,
    };
  }

  private async resolveCategoryShipping(
    product: ScrapedProduct,
  ): Promise<{ name: string; shippingEtb: number } | null> {
    const breadcrumb = product.breadcrumb ?? [];
    for (let i = breadcrumb.length - 1; i >= 0; i--) {
      const name = breadcrumb[i]?.trim();
      if (!name) continue;
      const category = await this.categoriesService.findByName(name);
      if (category) {
        const shipping = category.shippingCost ?? 0;
        const commission = category.commissionEtb ?? 0;
        if (shipping + commission > 0) {
          return { name: category.name, shippingEtb: shipping + commission };
        }
      }
    }

    const titleCategory = await this.categoriesService.findBestCategory(product.title);
    if (titleCategory) {
      const shipping = titleCategory.shippingCost ?? 0;
      const commission = titleCategory.commissionEtb ?? 0;
      if (shipping + commission > 0) {
        return { name: titleCategory.name, shippingEtb: shipping + commission };
      }
    }

    return null;
  }

  async resolveUsdToEtb(): Promise<number | null> {
    const pricing = this.config.get('pricing', { infer: true });
    const dbUsd = await this.settings.getNumber(SETTING_KEYS.USD_TO_ETB, 0);
    const usdToEtb = dbUsd > 0 ? dbUsd : pricing.usdToEtb;
    return usdToEtb && usdToEtb > 0 ? usdToEtb : null;
  }

  /**
   * Legacy entry point used at draft creation (delivery snapshot) and when
   * scraping provides a USD price. When `overrideUnitUsd` is set, runs the
   * full Dubai reverse-engineering pipeline.
   */
  async calculateOrderTotalEtb(
    product: ScrapedProduct,
    opts: CalculateOptions = {},
  ): Promise<OrderTotal> {
    const { deliveryEtb, matchedCategory } = await this.resolveDelivery(product);
    const rate = await this.resolveUsdToEtb();
    if (!rate) {
      throw new Error(
        'No ETB exchange rate configured. Set USD_TO_ETB from the admin panel or in .env.',
      );
    }

    const scrapedUnitUsd = extractScrapedUsd(product);
    const categoryName = opts.categoryName ?? matchedCategory;

    if (typeof opts.overrideUnitUsd === 'number' && opts.overrideUnitUsd > 0) {
      return this.priceFromEthUsd({
        ethUsd: opts.overrideUnitUsd,
        productId: opts.productId ?? product.productId,
        categoryName,
        deliveryEtb,
        quantity: opts.quantity ?? 1,
      });
    }

    return {
      totalEtb: deliveryEtb,
      sellingEtb: 0,
      unitEtbPerUnit: 0,
      deliveryEtb,
      marginPercent: resolveDynamicMarginPercent(0),
      rateUsed: rate,
      fromCurrency: 'USD',
      matchedCategory: categoryName,
      scrapedUnitUsd,
      effectiveUnitUsd: scrapedUnitUsd,
      dubaiUsd: 0,
      dubaiAed: 0,
      factorUsed: 1,
      confidence: 'estimate',
      triggers: ['none'],
    };
  }

  formatEtb(n: number): string {
    return Math.round(n).toLocaleString('en-US') + ' ETB';
  }
}
