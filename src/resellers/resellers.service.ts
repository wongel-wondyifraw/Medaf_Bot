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
      .andWhere('r.blocked_at IS NULL')
      .getMany();
  }

  async isBlocked(telegramId: number | string): Promise<boolean> {
    const row = await this.repo.findOne({
      where: { telegramId: String(telegramId) },
      select: { id: true, blockedAt: true },
    });
    return row?.blockedAt != null;
  }

  findAllBlocked(opts?: { limit?: number; offset?: number }): Promise<Reseller[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    return this.repo
      .createQueryBuilder('r')
      .where('r.blocked_at IS NOT NULL')
      .orderBy('r.blocked_at', 'DESC')
      .limit(limit)
      .offset(offset)
      .getMany();
  }

  findRegisteredNotBlocked(opts?: { limit?: number; offset?: number }): Promise<Reseller[]> {
    const limit = opts?.limit ?? 25;
    const offset = opts?.offset ?? 0;
    return this.repo
      .createQueryBuilder('r')
      .where('r.registered_at IS NOT NULL')
      .andWhere('r.full_name IS NOT NULL')
      .andWhere('r.phone_number IS NOT NULL')
      .andWhere('r.blocked_at IS NULL')
      .orderBy('r.full_name', 'ASC')
      .limit(limit)
      .offset(offset)
      .getMany();
  }

  countRegisteredNotBlocked(): Promise<number> {
    return this.repo
      .createQueryBuilder('r')
      .where('r.registered_at IS NOT NULL')
      .andWhere('r.full_name IS NOT NULL')
      .andWhere('r.phone_number IS NOT NULL')
      .andWhere('r.blocked_at IS NULL')
      .getCount();
  }

  countBlocked(): Promise<number> {
    return this.repo
      .createQueryBuilder('r')
      .where('r.blocked_at IS NOT NULL')
      .getCount();
  }

  async blockById(resellerId: number, reason?: string | null): Promise<Reseller | null> {
    const reseller = await this.findById(resellerId);
    if (!reseller) return null;
    reseller.blockedAt = new Date();
    reseller.blockReason = reason?.trim() || null;
    return this.repo.save(reseller);
  }

  async unblockById(resellerId: number): Promise<Reseller | null> {
    const reseller = await this.findById(resellerId);
    if (!reseller) return null;
    reseller.blockedAt = null;
    reseller.blockReason = null;
    return this.repo.save(reseller);
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
