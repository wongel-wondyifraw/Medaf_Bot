import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reseller } from './reseller.entity';

@Injectable()
export class ResellersService {
  constructor(
    @InjectRepository(Reseller)
    private readonly repo: Repository<Reseller>,
  ) {}

  findByTelegramId(telegramId: number | string): Promise<Reseller | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }

  findById(id: number): Promise<Reseller | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findOrCreateFromTelegram(user: {
    id: number;
    username?: string;
  }): Promise<Reseller> {
    const existing = await this.findByTelegramId(user.id);
    if (existing) {
      if (user.username && existing.telegramUsername !== user.username) {
        existing.telegramUsername = user.username;
        await this.repo.save(existing);
      }
      return existing;
    }
    const created = this.repo.create({
      telegramId: String(user.id),
      telegramUsername: user.username ?? null,
      fullName: null,
      phoneNumber: null,
      registeredAt: null,
    });
    return this.repo.save(created);
  }

  async setFullName(telegramId: number | string, fullName: string): Promise<Reseller> {
    const reseller = await this.findByTelegramId(telegramId);
    if (!reseller) throw new Error('Reseller not found');
    reseller.fullName = fullName.trim();
    return this.repo.save(reseller);
  }

  findAllRegistered(): Promise<Reseller[]> {
    return this.repo
      .createQueryBuilder('r')
      .where('r.registered_at IS NOT NULL')
      .andWhere('r.full_name IS NOT NULL')
      .andWhere('r.phone_number IS NOT NULL')
      .getMany();
  }

  async setPhoneNumber(
    telegramId: number | string,
    phoneNumber: string,
  ): Promise<Reseller> {
    const reseller = await this.findByTelegramId(telegramId);
    if (!reseller) throw new Error('Reseller not found');
    reseller.phoneNumber = phoneNumber.trim();
    if (reseller.fullName && reseller.phoneNumber) {
      reseller.registeredAt = new Date();
    }
    return this.repo.save(reseller);
  }
}
