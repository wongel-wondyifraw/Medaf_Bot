import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import {
  ObservationsService,
  PriceConfidence,
} from '../observations/observations.service';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import {
  FactorReason,
  FactorTier,
  resolveDynamicMarginPercent,
  runAedDirectPricing,
  runUsdBandDecision,
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
  usdToAed: number;
  fromCurrency: string;
  matchedCategory: string | null;
  scrapedUnitUsd: number | null;
  effectiveUnitUsd: number | null;
  dubaiUsd: number;
  dubaiAed: number;
  factorUsed: number;
  factorTier: FactorTier;
  factorReason: FactorReason;
  baseEtbRef: number;
  baseAed: number;
  dubaiCostEtb: number;
  sellEtb: number;
  profitEtb: number;
  confidence: PriceConfidence;
  triggers: string[];
}

export interface CalculateOptions {
  overrideUnitUsd?: number;
  overrideUnitAed?: number;
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

export interface PriceFromAedInput {
  dubaiAed: number;
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
    private readonly observations: ObservationsService,
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

  async resolveAedToEtb(): Promise<number | null> {
    const pricing = this.config.get('pricing', { infer: true });
    const db = await this.settings.getNumber(SETTING_KEYS.AED_TO_ETB, 0);
    const aedToEtb = db > 0 ? db : pricing.aedToEtb;
    return aedToEtb && aedToEtb > 0 ? aedToEtb : null;
  }

  async priceFromAed(input: PriceFromAedInput): Promise<OrderTotal> {
    const aedToEtb = await this.resolveAedToEtb();
    if (!aedToEtb) {
      throw new Error(
        'No AED→ETB rate configured. Set AED_TO_ETB from the admin panel or in .env.',
      );
    }

    const usdToAed = await this.resolveUsdToAed();
    const etbToAed = 1 / aedToEtb;

    const decision = runAedDirectPricing({
      dubaiAed: input.dubaiAed,
      deliveryEtb: input.deliveryEtb,
      etbToAed,
      quantity: input.quantity,
    });

    const impliedEthUsd = input.dubaiAed / usdToAed;

    this.logger.log(
      `Priced "${input.categoryName ?? 'unknown'}" ${input.dubaiAed} AED → ` +
        `${decision.totalEtb} ETB (margin ${decision.marginPercent}%, rate ${aedToEtb})`,
    );

    return {
      totalEtb: decision.totalEtb,
      sellingEtb: decision.totalEtb,
      unitEtbPerUnit: decision.unitEtbPerUnit,
      deliveryEtb: input.deliveryEtb,
      marginPercent: decision.marginPercent,
      rateUsed: aedToEtb,
      usdToAed,
      fromCurrency: 'AED',
      matchedCategory: input.categoryName,
      scrapedUnitUsd: null,
      effectiveUnitUsd: impliedEthUsd,
      dubaiUsd: impliedEthUsd,
      dubaiAed: decision.dubaiCostAed,
      factorUsed: 1,
      factorTier: 'low',
      factorReason: 'viable',
      baseEtbRef: decision.dubaiCostEtb,
      baseAed: input.dubaiAed,
      dubaiCostEtb: decision.dubaiCostEtb,
      sellEtb: decision.sellEtb,
      profitEtb: decision.profitEtb,
      confidence: 'medium',
      triggers: ['aed_direct'],
    };
  }

  async priceFromEthUsd(input: PriceFromEthUsdInput): Promise<OrderTotal> {
    const usdToEtb = await this.resolveUsdToEtb();
    if (!usdToEtb) {
      throw new Error(
        'No ETB exchange rate configured. Set USD_TO_ETB from the admin panel or in .env.',
      );
    }

    const usdToAed = await this.resolveUsdToAed();
    const etbToAed = usdToEtb > 0 ? usdToAed / usdToEtb : 0;

    const baseEtbRef = input.ethUsd * usdToEtb;
    const baseAed = input.ethUsd * usdToAed;

    const decision = runUsdBandDecision({
      ethUsd: input.ethUsd,
      baseAed,
      baseEtbRef,
      deliveryEtb: input.deliveryEtb,
      etbToAed,
      quantity: input.quantity,
    });

    const dubaiUsd = input.ethUsd * decision.factorUsed;
    const triggers = [
      `usd_band:${decision.tier}`,
      `factor:${decision.factorUsed}`,
      `reason:${decision.reason}`,
    ];
    if (decision.floored) triggers.push('floor:clamped');

    this.logger.log(
      `Priced "${input.categoryName ?? 'unknown'}" $${input.ethUsd} → ` +
        `usd_band ${decision.tier} (${decision.factorUsed}) = ${decision.totalEtb} ETB` +
        (decision.floored ? ' [floor-clamped]' : ''),
    );

    return {
      totalEtb: decision.totalEtb,
      sellingEtb: decision.totalEtb,
      unitEtbPerUnit: decision.unitEtbPerUnit,
      deliveryEtb: input.deliveryEtb,
      marginPercent: decision.marginPercent,
      rateUsed: usdToEtb,
      usdToAed,
      fromCurrency: 'USD',
      matchedCategory: input.categoryName,
      scrapedUnitUsd: null,
      effectiveUnitUsd: input.ethUsd,
      dubaiUsd,
      dubaiAed: decision.dubaiCostAed,
      factorUsed: decision.factorUsed,
      factorTier: decision.tier,
      factorReason: decision.reason,
      baseEtbRef: decision.baseEtbRef,
      baseAed: decision.baseAed,
      dubaiCostEtb: decision.dubaiCostEtb,
      sellEtb: decision.sellEtb,
      profitEtb: decision.profitEtb,
      confidence: decision.reason === 'usd_band' ? 'medium' : 'estimate',
      triggers,
    };
  }

  /**
   * Blends verified /addprice observation averages into the category avg factor.
   */
  private async blendObservedAvgFactor(
    productId: string | null,
    categoryName: string | null,
    dbAvg: number,
  ): Promise<number> {
    const pricing = this.config.get('pricing', { infer: true });
    const blend = pricing.obsBlend;
    if (blend <= 0) return dbAvg;

    let observed: number | null = null;

    if (productId) {
      const count = await this.observations.countByProduct(productId);
      if (count >= 5) {
        observed = await this.observations.avgFactorByProduct(productId);
      }
    }

    if (observed == null && categoryName) {
      const count = await this.observations.countByCategory(categoryName);
      if (count >= 10) {
        observed = await this.observations.avgFactorByCategory(categoryName);
      }
    }

    if (observed == null || observed <= 0) return dbAvg;
    return dbAvg * (1 - blend) + observed * blend;
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

  async resolveUsdToAed(): Promise<number> {
    const pricing = this.config.get('pricing', { infer: true });
    const db = await this.settings.getNumber(SETTING_KEYS.USD_TO_AED, 0);
    return db > 0 ? db : pricing.usdToAed ?? 3.67;
  }

  async resolveCeilingMultiplier(): Promise<number> {
    const pricing = this.config.get('pricing', { infer: true });
    const db = await this.settings.getNumber(
      SETTING_KEYS.PRICING_CEILING_MULTIPLIER,
      0,
    );
    return db > 0 ? db : pricing.ceilingMultiplier;
  }

  /**
   * Legacy entry point used at draft creation (delivery snapshot) and when
   * scraping provides a USD price. When `overrideUnitUsd` is set, runs the
   * three-factor decision engine.
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

    if (typeof opts.overrideUnitAed === 'number' && opts.overrideUnitAed > 0) {
      return this.priceFromAed({
        dubaiAed: opts.overrideUnitAed,
        categoryName,
        deliveryEtb,
        quantity: opts.quantity ?? 1,
      });
    }

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
      usdToAed: await this.resolveUsdToAed(),
      fromCurrency: 'USD',
      matchedCategory: categoryName,
      scrapedUnitUsd,
      effectiveUnitUsd: scrapedUnitUsd,
      dubaiUsd: 0,
      dubaiAed: 0,
      factorUsed: 1,
      factorTier: 'low',
      factorReason: 'viable',
      baseEtbRef: 0,
      baseAed: 0,
      dubaiCostEtb: 0,
      sellEtb: 0,
      profitEtb: 0,
      confidence: 'estimate',
      triggers: ['none'],
    };
  }

  formatEtb(n: number): string {
    return Math.round(n).toLocaleString('en-US') + ' ETB';
  }
}
