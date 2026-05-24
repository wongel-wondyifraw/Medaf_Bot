import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';

/**
 * Keywords that map SHEIN titles/slugs onto the local delivery catalog.
 * Order within each list does not matter: the matcher picks the longest
 * phrase across all categories so specific tokens beat generic ones.
 */
const KEYWORD_TO_CATEGORY: Record<string, string[]> = {
  'T-shirt': ['t-shirt', 'tshirt', 'tee', 'tees'],
  Shirt: ['shirt', 'blouse', 'button up', 'button-up', 'button down'],
  Dress: [
    'dress',
    'maxi dress',
    'long dress',
    'gown',
    'kaftan dress',
    'abaya',
    'evening dress',
    'formal dress',
  ],
  'Short Dress': [
    'mini dress',
    'midi dress',
    'short dress',
    'bodycon dress',
    'bodycon',
    'shirt dress',
    'sundress',
    't-shirt dress',
  ],
  Jeans: ['jeans', 'jean', 'denim pants'],
  Trousers: ['pants', 'trousers', 'leggings', 'joggers', 'slacks', 'chinos'],
  'Girls closed Shoes': ['sneakers', 'boots', 'ankle boot', 'shoes'],
  'Girls flat Shoes': [
    'flat',
    'flats',
    'loafer',
    'loafers',
    'ballet flat',
    'ballet flats',
    'sandals',
    'sandal',
    'slides',
    'flip flop',
    'flip flops',
    'mules',
  ],
  'Girls Hill Shoes': [
    'heel',
    'heels',
    'pump',
    'pumps',
    'stiletto',
    'wedge',
    'wedges',
    'heeled sandal',
    'heeled sandals',
  ],
  'Men shoes': [
    'men shoes',
    'mens shoes',
    "men's shoes",
    'men sneakers',
    'mens sneakers',
    'men boots',
    'mens boots',
    'men loafers',
    'men sandals',
    'mens sandals',
  ],
  'Body top': ['bodysuit', 'body suit', 'leotard'],
  'Jacket big': ['coat', 'puffer', 'parka', 'trench', 'overcoat', 'winter jacket'],
  'Jacket small': ['jacket', 'blazer', 'bomber', 'cardigan'],
  'Phone Cover': ['phone case', 'phone cover', 'iphone case', 'samsung case', 'phone holder'],
  'Bag(big)': ['backpack', 'tote', 'duffel', 'suitcase', 'luggage', 'travel bag'],
  'Bag(small)': ['clutch', 'crossbody', 'handbag', 'wallet', 'purse', 'shoulder bag', 'bag'],
  watch: ['watch', 'wristwatch', 'smartwatch'],
  '2pc Cloth': ['2pc', '2 piece', 'two piece', '2-piece', 'co-ord', 'matching set'],
  'Eye glass': ['sunglasses', 'eyeglasses', 'glasses', 'eyewear', 'shades'],
  Jewelery: [
    'necklace',
    'earring',
    'earrings',
    'bracelet',
    'ring',
    'pendant',
    'choker',
    'anklet',
    'jewelry',
    'jewellery',
  ],
  Underwear: ['underwear', 'bra', 'panties', 'lingerie', 'thong', 'brief', 'boxer'],
  Cosmetics: [
    'cosmetic',
    'cosmetics',
    'makeup',
    'make up',
    'make-up',
    'lipstick',
    'lip gloss',
    'lip balm',
    'mascara',
    'eyeliner',
    'eye shadow',
    'eyeshadow',
    'foundation',
    'concealer',
    'blush',
    'highlighter',
    'powder',
    'nail polish',
    'perfume',
    'fragrance',
    'skincare',
    'serum',
    'moisturizer',
    'shampoo',
    'conditioner',
    'beauty',
  ],
};

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
  ) {}

  findAll(): Promise<Category[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  findById(id: number | string): Promise<Category | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByName(name: string): Promise<Category | null> {
    return this.repo.findOne({ where: { name } });
  }

  async create(
    name: string,
    shippingCost: number | null = null,
    commissionEtb: number | null = null,
  ): Promise<{ category?: Category; error?: 'duplicate' | 'invalid' }> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return { error: 'invalid' };
    const existing = await this.findByName(trimmed);
    if (existing) return { error: 'duplicate' };
    const saved = await this.repo.save({ name: trimmed, shippingCost, commissionEtb });
    this.logger.log(
      `Category created: ${saved.name} (#${saved.id}) ` +
        `shipping_cost=${shippingCost ?? 'null'} commission_etb=${commissionEtb ?? 'null'}`,
    );
    return { category: saved };
  }

  async setShippingCost(
    id: number | string,
    cost: number | null,
  ): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.shippingCost = cost;
    await this.repo.save(existing);
    this.logger.log(`Category #${id} (${existing.name}) shipping_cost set to ${cost}`);
    return existing;
  }

  async setCommissionEtb(
    id: number | string,
    commission: number | null,
  ): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.commissionEtb = commission;
    await this.repo.save(existing);
    this.logger.log(
      `Category #${id} (${existing.name}) commission_etb set to ${commission}`,
    );
    return existing;
  }

  async clearCosts(id: number | string): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.shippingCost = null;
    existing.commissionEtb = null;
    await this.repo.save(existing);
    this.logger.log(`Category #${id} (${existing.name}) costs cleared`);
    return existing;
  }

  /**
   * Best-effort mapping from an arbitrary product title to a known category.
   * Walks both:
   *   1. A curated keyword → category map (handles things like
   *      "dress" → "Women Clothing"); and
   *   2. Direct word matches against the category name itself.
   * The match with the longest matched token wins (more specific beats less
   * specific). Returns null when no match is found.
   */
  async findBestMatchByText(text: string): Promise<Category | null> {
    if (!text) return null;
    const lower = text.toLowerCase();
    const all = await this.findAll();
    const byName = new Map(all.map((c) => [c.name, c]));

    let best: { category: Category; score: number } | null = null;

    for (const [catName, keywords] of Object.entries(KEYWORD_TO_CATEGORY)) {
      const cat = byName.get(catName);
      if (!cat) continue;
      for (const kw of keywords) {
        if (this.wordMatches(lower, kw)) {
          const score = kw.length;
          if (!best || score > best.score) best = { category: cat, score };
        }
      }
    }

    for (const cat of all) {
      if (this.wordMatches(lower, cat.name)) {
        const score = cat.name.length;
        if (!best || score > best.score) best = { category: cat, score };
      }
    }

    return best?.category ?? null;
  }

  private wordMatches(haystack: string, needle: string): boolean {
    if (!needle) return false;
    const escaped = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  }
}
