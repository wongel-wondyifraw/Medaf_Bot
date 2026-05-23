import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 5 * 60 * 1000;

interface PendingCategoryEdit {
  categoryId: number;
  since: number;
}

interface PendingNewCategory {
  name: string;
  since: number;
}

interface PendingNewCategoryFee {
  fee: number | null;
  since: number;
}

@Injectable()
export class CategoryEditStateService {
  private readonly state = new Map<number, PendingCategoryEdit>();
  private readonly newNameState = new Map<number, PendingNewCategory>();
  private readonly newFeeState = new Map<number, PendingNewCategoryFee>();

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

  setPendingNewName(userId: number, name: string): void {
    this.newNameState.set(userId, { name, since: Date.now() });
  }

  getPendingNewName(userId: number): string | null {
    const entry = this.newNameState.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.newNameState.delete(userId);
      return null;
    }
    return entry.name;
  }

  clearPendingNewName(userId: number): void {
    this.newNameState.delete(userId);
  }

  setPendingNewFee(userId: number, fee: number | null): void {
    this.newFeeState.set(userId, { fee, since: Date.now() });
  }

  getPendingNewFee(userId: number): number | null | undefined {
    const entry = this.newFeeState.get(userId);
    if (!entry) return undefined;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.newFeeState.delete(userId);
      return undefined;
    }
    return entry.fee;
  }

  clearPendingNewFee(userId: number): void {
    this.newFeeState.delete(userId);
  }

  clearPendingNewCategory(userId: number): void {
    this.clearPendingNewName(userId);
    this.clearPendingNewFee(userId);
  }
}
