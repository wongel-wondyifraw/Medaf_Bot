import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ScrapedProduct } from '../scraper/types';

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
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private pickRate(currency: string): { rate: number | null; fromCurrency: string } {
    const upper = (currency || '').toUpperCase();
    const pricing = this.config.get('pricing', { infer: true });
    const { usdToEtb, eurToEtb, gbpToEtb } = pricing;

    if (upper === 'EUR' && eurToEtb) return { rate: eurToEtb, fromCurrency: 'EUR' };
    if (upper === 'GBP' && gbpToEtb) return { rate: gbpToEtb, fromCurrency: 'GBP' };
    if (upper === 'USD' && usdToEtb) return { rate: usdToEtb, fromCurrency: 'USD' };
    if (usdToEtb) return { rate: usdToEtb, fromCurrency: 'USD' };
    return { rate: null, fromCurrency: upper || 'USD' };
  }

  calculateOrderTotalEtb(product: ScrapedProduct): OrderTotal {
    const pricing = this.config.get('pricing', { infer: true });
    const margin = pricing.profitMarginPercent;
    const delivery = pricing.deliveryCostEtb;

    let foreignPrice = product.price;
    let pickedCurrency = product.currency || 'USD';

    if (typeof product.priceUsd === 'number' && product.priceUsd > 0) {
      foreignPrice = product.priceUsd;
      pickedCurrency = 'USD';
    }

    const { rate, fromCurrency } = this.pickRate(pickedCurrency);
    if (!rate) {
      throw new Error(
        'No ETB exchange rate configured. Set USD_TO_ETB (and optionally EUR_TO_ETB, GBP_TO_ETB) in .env.',
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
