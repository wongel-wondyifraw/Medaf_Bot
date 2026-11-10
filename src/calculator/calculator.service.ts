import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CategoriesService } from '../categories/categories.service';
import { AppConfig } from '../config/configuration';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import { runAedDirectPricing } from './pricing-math';

export const DEFAULT_DELIVERY_ETB = 500;

export interface OrderTotal {
  totalEtb: number;
  /** Per-unit final ETB (margin on Dubai cost + delivery). */
  unitEtbPerUnit: number;
  deliveryEtb: number;
  marginPercent: number;
  rateUsed: number;
  dubaiCostEtb: number;
  sellEtb: number;
  profitEtb: number;
}

export interface PriceFromAedInput {
  dubaiAed: number;
  categoryName: string | null;
  deliveryEtb: number;
  quantity: number;
}

@Injectable()
export class CalculatorService {
  private readonly logger = new Logger(CalculatorService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: SettingsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async resolveDelivery(input: {
    title: string;
    categoryName?: string | null;
  }): Promise<{ deliveryEtb: number; matchedCategory: string | null }> {
    const categoryMatch = await this.resolveCategoryShipping(input);
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

    const decision = runAedDirectPricing({
      dubaiAed: input.dubaiAed,
      deliveryEtb: input.deliveryEtb,
      aedToEtb,
      quantity: input.quantity,
    });

    this.logger.log(
      `Priced "${input.categoryName ?? 'unknown'}" ${input.dubaiAed} AED → ` +
        `${decision.totalEtb} ETB (margin ${decision.marginPercent}%, rate ${aedToEtb})`,
    );

    return {
      totalEtb: decision.totalEtb,
      unitEtbPerUnit: decision.unitEtbPerUnit,
      deliveryEtb: input.deliveryEtb,
      marginPercent: decision.marginPercent,
      rateUsed: aedToEtb,
      dubaiCostEtb: decision.dubaiCostEtb,
      sellEtb: decision.sellEtb,
      profitEtb: decision.profitEtb,
    };
  }

  private async resolveCategoryShipping(input: {
    title: string;
    categoryName?: string | null;
  }): Promise<{ name: string; shippingEtb: number } | null> {
    const name = input.categoryName?.trim();
    if (name) {
      const category = await this.categoriesService.findByName(name);
      if (category) {
        const shipping = category.shippingCost ?? 0;
        const commission = category.commissionEtb ?? 0;
        if (shipping + commission > 0) {
          return { name: category.name, shippingEtb: shipping + commission };
        }
      }
    }

    const titleCategory = await this.categoriesService.findBestCategory(input.title);
    if (titleCategory) {
      const shipping = titleCategory.shippingCost ?? 0;
      const commission = titleCategory.commissionEtb ?? 0;
      if (shipping + commission > 0) {
        return { name: titleCategory.name, shippingEtb: shipping + commission };
      }
    }

    return null;
  }
}
