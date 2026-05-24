import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 5 * 60 * 1000;

export interface AddPriceDraft {
  productId: string;
  productLink: string;
  categoryName: string | null;
  ethUsd: number | null;
  since: number;
}

@Injectable()
export class AddPriceStateService {
  private readonly state = new Map<number, AddPriceDraft>();

  setLink(userId: number, productId: string, productLink: string): void {
    this.state.set(userId, {
      productId,
      productLink,
      categoryName: null,
      ethUsd: null,
      since: Date.now(),
    });
  }

  setCategory(userId: number, categoryName: string): AddPriceDraft | null {
    const draft = this.get(userId);
    if (!draft) return null;
    draft.categoryName = categoryName;
    draft.since = Date.now();
    return draft;
  }

  setEthUsd(userId: number, ethUsd: number): AddPriceDraft | null {
    const draft = this.get(userId);
    if (!draft) return null;
    draft.ethUsd = ethUsd;
    draft.since = Date.now();
    return draft;
  }

  get(userId: number): AddPriceDraft | null {
    const entry = this.state.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.state.delete(userId);
      return null;
    }
    return entry;
  }

  clear(userId: number): void {
    this.state.delete(userId);
  }
}
