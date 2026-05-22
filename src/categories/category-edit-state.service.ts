import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 5 * 60 * 1000;

interface PendingCategoryEdit {
  categoryId: number;
  since: number;
}

@Injectable()
export class CategoryEditStateService {
  private readonly state = new Map<number, PendingCategoryEdit>();

  setPending(userId: number, categoryId: number): void {
    this.state.set(userId, { categoryId, since: Date.now() });
  }

  getPending(userId: number): number | null {
    const entry = this.state.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.state.delete(userId);
      return null;
    }
    return entry.categoryId;
  }

  clearPending(userId: number): void {
    this.state.delete(userId);
  }
}
