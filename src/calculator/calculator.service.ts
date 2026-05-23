import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

export const DEFAULT_DELIVERY_ETB = 500;

/**
 * Dynamic profit margin tiers, applied based on the unit cost price in ETB
 * (i.e. unit USD × USD→ETB rate, BEFORE margin is added).
 *
 *   • cost  < 5,000 ETB        → 30%
 *   • 5,000 ≤ cost ≤ 10,000    → 20%
 *   • cost > 10,000 ETB        → 15%
 */
export function resolveDynamicMarginPercent(unitCostEtb: number): number {
  if (!Number.isFinite(unitCostEtb) || unitCostEtb <= 0) return 30;
  if (unitCostEtb < 5000) return 30;
  if (unitCostEtb <= 10000) return 20;
  return 15;
}

export interface OrderTotal {
  totalEtb: number;
  sellingEtb: number;
  deliveryEtb: number;
  marginPercent: number;
  rateUsed: number;
  fromCurrency: string;
  matchedCategory: string | null;
  /**
   * The unit price in USD as derived from the scraper. Null when the scraper
   * provided no USD-equivalent value (e.g. unsupported currency).
   */
  scrapedUnitUsd: number | null;
  /**
   * The unit price in USD that was actually used to compute selling_etb.
   * Equals overrideUnitUsd when provided, otherwise equals scrapedUnitUsd.
   */
  effectiveUnitUsd: number | null;
}

export interface CalculateOptions {
  /**
   * When provided, this USD value is used instead of the scraper price and
   * the ETB conversion goes through USD→ETB regardless of the scraped
   * currency.
   */
  overrideUnitUsd?: number;
}

/**
 * Pulls the USD unit price out of a scraped product. Prefers the explicit
 * `priceUsd` field (set by providers when SHEIN exposes a USD figure) and
 * falls back to `price` when the currency is already USD. Returns null when
 * the scraped data is in some other currency.
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
  ) {}

  /**
   * Resolves the shipping cost for a product by matching its breadcrumb
   * against the `categories` table. Walks the breadcrumb from most-specific
   * to least-specific and returns the first category that has a non-null
   * shipping_cost. Returns null when no category match has a configured cost.
   */
  private async resolveCategoryShipping(
    product: ScrapedProduct,
  ): Promise<{ name: string; shippingEtb: number } | null> {
    const breadcrumb = product.breadcrumb ?? [];
    if (breadcrumb.length === 0) return null;
    for (let i = breadcrumb.length - 1; i >= 0; i--) {
      const name = breadcrumb[i]?.trim();
      if (!name) continue;
      const category = await this.categoriesService.findByName(name);
      if (category && category.shippingCost != null) {
        return { name: category.name, shippingEtb: category.shippingCost };
      }
    }
    return null;
  }

  private async pickRate(
    currency: string,
  ): Promise<{ rate: number | null; fromCurrency: string }> {
    const upper = (currency || '').toUpperCase();
    const pricing = this.config.get('pricing', { infer: true });
    const dbUsd = await this.settings.getNumber(SETTING_KEYS.USD_TO_ETB, 0);
    const usdToEtb = dbUsd > 0 ? dbUsd : pricing.usdToEtb;
    const { eurToEtb, gbpToEtb } = pricing;

    if (upper === 'EUR' && eurToEtb) return { rate: eurToEtb, fromCurrency: 'EUR' };
    if (upper === 'GBP' && gbpToEtb) return { rate: gbpToEtb, fromCurrency: 'GBP' };
    if (upper === 'USD' && usdToEtb) return { rate: usdToEtb, fromCurrency: 'USD' };
    if (usdToEtb) return { rate: usdToEtb, fromCurrency: 'USD' };
    return { rate: null, fromCurrency: upper || 'USD' };
  }

  async calculateOrderTotalEtb(
    product: ScrapedProduct,
    opts: CalculateOptions = {},
  ): Promise<OrderTotal> {
    const categoryMatch = await this.resolveCategoryShipping(product);
    const delivery = categoryMatch ? categoryMatch.shippingEtb : DEFAULT_DELIVERY_ETB;
    if (categoryMatch) {
      this.logger.log(
        `Shipping for "${product.title.slice(0, 40)}…" resolved from category ` +
          `"${categoryMatch.name}" = ${delivery} ETB`,
      );
    } else {
      this.logger.log(
        `Shipping for "${product.title.slice(0, 40)}…" fell back to default ${DEFAULT_DELIVERY_ETB} ETB ` +
          `(breadcrumb=${(product.breadcrumb ?? []).join(' > ') || 'empty'})`,
      );
    }

    const scrapedUnitUsd = extractScrapedUsd(product);

    let foreignPrice: number;
    let pickedCurrency: string;
    let effectiveUnitUsd: number | null;

    if (typeof opts.overrideUnitUsd === 'number' && opts.overrideUnitUsd > 0) {
      // User-supplied override is always interpreted as USD. The scraped
      // currency/EUR/GBP path is bypassed so the math is consistent with
      // what the reseller typed.
      foreignPrice = opts.overrideUnitUsd;
      pickedCurrency = 'USD';
      effectiveUnitUsd = opts.overrideUnitUsd;
    } else if (typeof product.priceUsd === 'number' && product.priceUsd > 0) {
      foreignPrice = product.priceUsd;
      pickedCurrency = 'USD';
      effectiveUnitUsd = product.priceUsd;
    } else {
      foreignPrice = product.price;
      pickedCurrency = product.currency || 'USD';
      effectiveUnitUsd = scrapedUnitUsd;
    }

    const { rate, fromCurrency } = await this.pickRate(pickedCurrency);
    if (!rate) {
      throw new Error(
        'No ETB exchange rate configured. Set USD_TO_ETB from the admin panel or in .env.',
      );
    }

    // Tiered margin is driven by the per-unit cost in ETB (pre-margin).
    // foreignPrice may be in USD/EUR/GBP, so we use the resolved rate to
    // approximate the cost ETB regardless of source currency.
    const unitCostEtb = foreignPrice * rate;
    const margin = resolveDynamicMarginPercent(unitCostEtb);

    const sellingForeign = foreignPrice * (1 + margin / 100);
    const sellingEtb = sellingForeign * rate;
    const totalEtb = sellingEtb + delivery;

    return {
      totalEtb: Math.round(totalEtb),
      sellingEtb: Math.round(sellingEtb),
      deliveryEtb: Math.round(delivery),
      marginPercent: margin,
      rateUsed: rate,
      fromCurrency,
      matchedCategory: categoryMatch?.name ?? null,
      scrapedUnitUsd,
      effectiveUnitUsd,
    };
  }

  formatEtb(n: number): string {
    return Math.round(n).toLocaleString('en-US') + ' ETB';
  }
}
