import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

export interface OrderTotal {
  totalEtb: number;
  sellingEtb: number;
  deliveryEtb: number;
  marginPercent: number;
  rateUsed: number;
  fromCurrency: string;
}

@Injectable()
export class CalculatorService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: SettingsService,
  ) {}

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
    const delivery = await this.settings.getNumber(
      SETTING_KEYS.DELIVERY_ETB,
      pricing.deliveryCostEtb,
    );

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
    };
  }

  formatEtb(n: number): string {
    return Math.round(n).toLocaleString('en-US') + ' ETB';
  }
}
