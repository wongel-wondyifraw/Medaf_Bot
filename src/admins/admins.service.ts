import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from './admin.entity';

@Injectable()
export class AdminsService {
  constructor(
    @InjectRepository(Admin)
    private readonly repo: Repository<Admin>,
  ) {}

  async isAdmin(telegramId: number | string): Promise<boolean> {
    const count = await this.repo.count({ where: { telegramId: String(telegramId) } });
    return count > 0;
  }

  findByTelegramId(telegramId: number | string): Promise<Admin | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }

  async grant(telegramId: number | string, username: string | null): Promise<Admin> {
    const existing = await this.findByTelegramId(telegramId);
    if (existing) {
      if (username && existing.telegramUsername !== username) {
        existing.telegramUsername = username;
        await this.repo.save(existing);
      }
      return existing;
    }
    const created = this.repo.create({
      telegramId: String(telegramId),
      telegramUsername: username,
      lastNotifiedAt: null,
    });
    return this.repo.save(created);
  }

  findAll(): Promise<Admin[]> {
    return this.repo.find({ order: { addedAt: 'ASC' } });
  }

  async updateLastNotified(id: number, when: Date): Promise<void> {
    await this.repo.update(id, { lastNotifiedAt: when });
  }

  async deleteByTelegramId(telegramId: number | string): Promise<boolean> {
    const result = await this.repo.delete({ telegramId: String(telegramId) });
    return (result.affected ?? 0) > 0;
  }
}
