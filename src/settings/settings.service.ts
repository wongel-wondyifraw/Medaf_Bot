import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { Setting } from './setting.entity';

export const SETTING_KEYS = {
  PROFIT_MARGIN: 'profit_margin_percent',
  DELIVERY_ETB: 'delivery_cost_etb',
  USD_TO_ETB: 'usd_to_etb',
  USD_TO_AED: 'usd_to_aed',
  AED_TO_ETB: 'aed_to_etb',
  PRICING_CEILING_MULTIPLIER: 'pricing_ceiling_multiplier',
  PRICING_FINAL_MULTIPLIER: 'pricing_final_multiplier',
  PAYMENT_BANK_ACCOUNT: 'payment_bank_account',
} as const;

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly repo: Repository<Setting>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const pricing = this.config.get('pricing', { infer: true });
    const paymentBankAccount = this.config.get('paymentBankAccount', { infer: true });
    const defaults: Array<[string, string | null]> = [
      [SETTING_KEYS.PROFIT_MARGIN, String(pricing.profitMarginPercent)],
      [SETTING_KEYS.DELIVERY_ETB, String(pricing.deliveryCostEtb)],
      [SETTING_KEYS.USD_TO_ETB, pricing.usdToEtb != null ? String(pricing.usdToEtb) : null],
      [
        SETTING_KEYS.USD_TO_AED,
        pricing.usdToAed != null ? String(pricing.usdToAed) : null,
      ],
      [SETTING_KEYS.AED_TO_ETB, pricing.aedToEtb != null ? String(pricing.aedToEtb) : null],
      [
        SETTING_KEYS.PRICING_CEILING_MULTIPLIER,
        String(pricing.ceilingMultiplier),
      ],
      [
        SETTING_KEYS.PRICING_FINAL_MULTIPLIER,
        String(pricing.finalMultiplier),
      ],
      [SETTING_KEYS.PAYMENT_BANK_ACCOUNT, paymentBankAccount || null],
    ];

    for (const [key, value] of defaults) {
      if (value == null) continue;
      const existing = await this.repo.findOne({ where: { key } });
      if (!existing) {
        await this.repo.save({ key, value });
        this.logger.log(`Seeded setting ${key}=${value} from .env`);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { key } });
    return row?.value ?? null;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key);
    if (raw == null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  async set(key: string, value: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      await this.repo.save(existing);
    } else {
      await this.repo.save({ key, value });
    }
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }
}
