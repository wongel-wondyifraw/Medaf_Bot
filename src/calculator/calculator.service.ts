import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

export const DEFAULT_DELIVERY_ETB = 500;

export interface OrderTotal {
  totalEtb: number;
  sellingEtb: number;
  deliveryEtb: number;
  marginPercent: number;
  rateUsed: number;
  fromCurrency: string;
  matchedCategory: string | null;
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

  async calculateOrderTotalEtb(product: ScrapedProduct): Promise<OrderTotal> {
    const pricing = this.config.get('pricing', { infer: true });
    const margin = await this.settings.getNumber(
      SETTING_KEYS.PROFIT_MARGIN,
      pricing.profitMarginPercent,
    );

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

    let foreignPrice = product.price;
    let pickedCurrency = product.currency || 'USD';

    if (typeof product.priceUsd === 'number' && product.priceUsd > 0) {
      foreignPrice = product.priceUsd;
      pickedCurrency = 'USD';
    }

    const { rate, fromCurrency } = await this.pickRate(pickedCurrency);
    if (!rate) {
      throw new Error(
        'No ETB exchange rate configured. Set USD_TO_ETB from the admin panel or in .env.',
      );
    }

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
    };
  }

  formatEtb(n: number): string {
    return Math.round(n).toLocaleString('en-US') + ' ETB';
  }
}
