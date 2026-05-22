import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';

/**
 * Keywords that map to a category in the seeded `categories` table. Used by
 * the bot's manual order flow to pick a shipping cost from the product
 * title alone (when no scraped breadcrumb is available). Order within each
 * list does not matter — the matcher picks the longest match across all
 * categories so more specific tokens beat shorter ones.
 */
const KEYWORD_TO_CATEGORY: Record<string, string[]> = {
  Kids: ['kids', 'tween', 'girls', 'boys', 'toddler', 'children'],
  'Baby & Maternity': ['baby', 'infant', 'maternity', 'newborn', 'nursing'],
  Beachwear: ['bikini', 'swimsuit', 'swimwear', 'beachwear'],
  'Underwear & Sleepwear': [
    'bra', 'panties', 'lingerie', 'underwear', 'pajama', 'pyjama',
    'sleepwear', 'robe', 'nightgown',
  ],
  Curve: ['plus size', 'curve'],
  'Women Clothing': [
    'dress', 'blouse', 'cardigan', 'jumpsuit', 'romper', 'bodysuit', 'skirt',
    'gown',
  ],
  'Men Clothing': ["men's", 'mens', 'menswear'],
  Shoes: ['shoes', 'sneakers', 'sandals', 'boots', 'heels', 'flats', 'loafers'],
  'Bags & Luggage': [
    'handbag', 'backpack', 'wallet', 'tote', 'clutch', 'luggage', 'suitcase',
    'bag',
  ],
  'Jewelry & Accessories': [
    'necklace', 'earring', 'bracelet', 'ring', 'watch', 'pendant', 'choker',
    'anklet',
  ],
  'Beauty & Health': [
    'lipstick', 'makeup', 'mascara', 'perfume', 'skincare', 'cosmetic',
    'shampoo',
  ],
  'Home & Living': ['cushion', 'curtain', 'rug', 'lamp', 'pillow', 'vase', 'decor'],
  'Sports & Outdoors': [
    'yoga', 'gym', 'fitness', 'sport', 'workout', 'athletic', 'running',
  ],
  'Home Textiles': ['towel', 'bedsheet', 'duvet', 'bedding', 'tablecloth'],
  'Cell Phones & Accessories': [
    'phone case', 'charger', 'cable', 'earphone', 'earbud', 'screen protector',
  ],
  Electronics: ['headphone', 'speaker', 'led light', 'projector'],
  'Toys & Games': ['toy', 'doll', 'puzzle', 'lego', 'plush'],
  'Tools & Home Improvement': ['drill', 'hammer', 'wrench', 'screwdriver'],
  'Office & School Supplies': ['notebook', 'stationery', 'planner', 'pencil case'],
  'Pet Supplies': ['leash', 'collar', 'pet bowl', 'pet bed'],
  'Books & Magazine': ['book', 'magazine'],
  'Food & Beverages': ['candy', 'snack', 'beverage'],
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

  findById(id: number): Promise<Category | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByName(name: string): Promise<Category | null> {
    return this.repo.findOne({ where: { name } });
  }

  async create(
    name: string,
    shippingCost: number | null = null,
  ): Promise<{ category?: Category; error?: 'duplicate' | 'invalid' }> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return { error: 'invalid' };
    const existing = await this.findByName(trimmed);
    if (existing) return { error: 'duplicate' };
    const saved = await this.repo.save({ name: trimmed, shippingCost });
    this.logger.log(
      `Category created: ${saved.name} (#${saved.id}) shipping_cost=${shippingCost ?? 'null'}`,
    );
    return { category: saved };
  }

  async setShippingCost(id: number, cost: number | null): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.shippingCost = cost;
    await this.repo.save(existing);
    this.logger.log(`Category #${id} (${existing.name}) shipping_cost set to ${cost}`);
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
