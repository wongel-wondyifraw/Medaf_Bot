import { Injectable } from '@nestjs/common';

const STATE_TTL_MS = 30 * 60 * 1000;

export type DraftStep = 'size' | 'color' | 'qty' | 'confirm';

export interface OrderDraft {
  productId: string | null;
  link: string;
  productTitle: string;
  sizes: string[];
  colors: string[];
  selectedSize: string | null;
  selectedColor: string | null;
  quantity: number;
  unitEtb: number;
  totalEtb: number;
  step: DraftStep;
  since: number;
}

export interface CreateDraftInput {
  productId: string | null;
  link: string;
  productTitle: string;
  sizes: string[];
  colors: string[];
  unitEtb: number;
}

@Injectable()
export class OrderDraftStateService {
  private readonly drafts = new Map<number, OrderDraft>();

  setDraft(userId: number, input: CreateDraftInput): OrderDraft {
    const step: DraftStep =
      input.sizes.length > 0 ? 'size' : input.colors.length > 0 ? 'color' : 'qty';
    const draft: OrderDraft = {
      productId: input.productId,
      link: input.link,
      productTitle: input.productTitle,
      sizes: input.sizes,
      colors: input.colors,
      selectedSize: null,
      selectedColor: null,
      quantity: 1,
      unitEtb: input.unitEtb,
      totalEtb: input.unitEtb,
      step,
      since: Date.now(),
    };
    this.drafts.set(userId, draft);
    return draft;
  }

  getDraft(userId: number): OrderDraft | null {
    const entry = this.drafts.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.since > STATE_TTL_MS) {
      this.drafts.delete(userId);
      return null;
    }
    return entry;
  }

  clearDraft(userId: number): void {
    this.drafts.delete(userId);
  }

  selectSize(userId: number, size: string): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.selectedSize = size;
    draft.step = draft.colors.length > 0 ? 'color' : 'qty';
    draft.since = Date.now();
    return draft;
  }

  selectColor(userId: number, color: string): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.selectedColor = color;
    draft.step = 'qty';
    draft.since = Date.now();
    return draft;
  }

  selectQuantity(userId: number, quantity: number): OrderDraft | null {
    const draft = this.getDraft(userId);
    if (!draft) return null;
    draft.quantity = quantity;
    draft.totalEtb = draft.unitEtb * quantity;
    draft.step = 'confirm';
    draft.since = Date.now();
    return draft;
  }
}
