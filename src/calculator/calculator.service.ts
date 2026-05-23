import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

export const DEFAULT_DELIVERY_ETB = 500;

/**
 * Dynamic profit margin tiers, picked from the per-unit subtotal in ETB
 * (unit USD × USD→ETB rate + category delivery, BEFORE margin is added).
 * The chosen percentage is then applied to that same subtotal — i.e.
 * delivery is marked up alongside the product.
 *
 *   • subtotal  < 3,000 ETB         → 30%
 *   • 3,000 ≤ subtotal ≤ 10,000    → 20%
 *   • subtotal > 10,000 ETB         → 15%
 */
export function resolveDynamicMarginPercent(unitSubtotalEtb: number): number {
  if (!Number.isFinite(unitSubtotalEtb) || unitSubtotalEtb <= 0) return 30;
  if (unitSubtotalEtb < 3000) return 30;
  if (unitSubtotalEtb <= 10000) return 20;
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
   * Resolves per-item delivery for a product by matching its breadcrumb
   * against the `categories` table. Walks the breadcrumb from most-specific
   * to least-specific and returns the first category that has a configured
   * shipping fee or commission. Returns null when no category match has costs.
   */
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

    const titleCategory = await this.categoriesService.findBestMatchByText(product.title);
    if (titleCategory) {
      const shipping = titleCategory.shippingCost ?? 0;
      const commission = titleCategory.commissionEtb ?? 0;
      if (shipping + commission > 0) {
        return { name: titleCategory.name, shippingEtb: shipping + commission };
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

    // 1) baseEtb     = USD × rate
    // 2) subtotal    = baseEtb + delivery        (delivery folded in first)
    // 3) margin tier picked from subtotal
    // 4) selling     = subtotal × (1 + margin/100)  (margin marks up delivery too)
    // 5) total       = ceil(selling)                ("round up if necessary")
    const unitCostEtb = foreignPrice * rate;
    const unitSubtotalEtb = unitCostEtb + delivery;
    const margin = resolveDynamicMarginPercent(unitSubtotalEtb);
    const sellingEtb = unitSubtotalEtb * (1 + margin / 100);
    const totalEtb = sellingEtb;

    return {
      totalEtb: Math.ceil(totalEtb),
      sellingEtb: Math.ceil(sellingEtb),
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
