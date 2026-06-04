import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  defaultDubaiFactorForGroup,
  resolveBroadGroup,
} from '../calculator/broad-group';
import { CategoryAiService } from './category-ai.service';
import { Category } from './category.entity';

/**
 * Keywords that map SHEIN titles/slugs onto the local delivery catalog.
 * Order within each list does not matter: the matcher picks the longest
 * phrase across all categories so specific tokens beat generic ones.
 */
const KEYWORD_TO_CATEGORY: Record<string, string[]> = {
  'T-shirt': ['t-shirt', 'tshirt', 'tee', 'tees'],
  Shirt: ['shirt', 'blouse', 'button up', 'button-up', 'button down'],
  'Wedding Dress': [
    'wedding dress',
    'wedding gown',
    'bridal dress',
    'bridal gown',
    'bride dress',
  ],
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
  Trousers: [
    'pants', 'trousers', 'leggings', 'joggers', 'slacks', 'chinos',
    'sweatpants', 'sweat pants',
    'trackpants', 'track pants', 'tracksuit pants',
    'jogpants', 'jog pants', 'jogger pants',
    'cargopants', 'cargo pants',
    'palazzo', 'capri', 'culottes',
  ],
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
  'Phone Cover': [
    'phone case', 'phone cover', 'iphone case', 'samsung case', 'phone holder',
  ],
  'Cell Phones & Accessories': [
    'tablet case', 'tablet cover', 'tablet protective case', 'tablet sleeve',
    'ipad case', 'ipad cover', 'ipad sleeve',
    'laptop sleeve', 'laptop case',
  ],
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

/**
 * Weak keywords only win when no strong keyword matched anywhere.
 * Use for occasion/style words (e.g. "wedding") that appear in many
 * product types — shoe/bag/dress strong tokens always take priority.
 */
const WEAK_KEYWORDS_BY_CATEGORY: Record<string, readonly string[]> = {
  'Wedding Dress': ['wedding', 'bridal', 'bride'],
};

/**
 * Strong-match precedence. When several strong categories match the same
 * title, the one with the highest priority wins regardless of keyword
 * length (ties fall back to longest matched keyword). This lets a more
 * specific feature beat a more generic one, e.g. a "high heel sandal" is a
 * heel first (Girls Hill Shoes) even though "sandals" is the longer token.
 * Unlisted categories default to priority 0.
 */
const CATEGORY_PRIORITY: Record<string, number> = {
  'Girls Hill Shoes': 2,
};

/**
 * Categories that only apply to women's products. When the product title
 * contains a men-context word, every match against these categories is
 * suppressed so titles like "Men's Shirt Dress Shirt" don't fall into
 * "Short Dress" purely on substring length.
 */
const WOMEN_ONLY_CATEGORIES = new Set<string>([
  'Dress',
  'Short Dress',
  'Body top',
  'Wedding Dress',
  'Girls closed Shoes',
  'Girls flat Shoes',
  'Girls Hill Shoes',
]);

/**
 * Shoe-shape keywords used to detect that a men-context title is about
 * footwear, so we can route it to "Men shoes" instead of dropping it
 * because every Girls* category was skipped.
 */
const SHOE_KEYWORDS: string[] = [
  'penny loafer',
  'penny loafers',
  'ballet flat',
  'ballet flats',
  'ankle boot',
  'ankle boots',
  'flip flop',
  'flip flops',
  'driving shoes',
  'heeled sandal',
  'heeled sandals',
  'loafer',
  'loafers',
  'sneaker',
  'sneakers',
  'boot',
  'boots',
  'sandal',
  'sandals',
  'slides',
  'mules',
  'flat',
  'flats',
  'heel',
  'heels',
  'pump',
  'pumps',
  'stiletto',
  'wedge',
  'wedges',
  'shoes',
];

const MEN_CONTEXT_REGEX = /\b(mens?|men's|man's|male|manfinity)\b/i;
const WOMEN_CONTEXT_REGEX = /\b(womens?|women's|woman's|female|girls?|ladies|lady)\b/i;

type CategoryMatch = { category: Category; priority: number; score: number };

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
    private readonly categoryAi: CategoryAiService,
  ) {}

  findAll(): Promise<Category[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  findById(id: number | string): Promise<Category | null> {
    return this.repo
      .createQueryBuilder('category')
      .where('category.id = :id', { id })
      .getOne();
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
    const broadGroup = resolveBroadGroup(trimmed);
    const saved = await this.repo.save({
      name: trimmed,
      shippingCost,
      commissionEtb,
      dubaiFactor: defaultDubaiFactorForGroup(broadGroup),
    });
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

  async setShippingCostByName(
    name: string,
    cost: number | null,
  ): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.shippingCost = cost;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) shipping_cost set to ${cost}`,
    );
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

  async setCommissionEtbByName(
    name: string,
    commission: number | null,
  ): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.commissionEtb = commission;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) commission_etb set to ${commission}`,
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

  async clearCostsByName(name: string): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.shippingCost = null;
    existing.commissionEtb = null;
    await this.repo.save(existing);
    this.logger.log(`Category "${name}" (#${existing.id}) costs cleared`);
    return existing;
  }

  async setDubaiFactor(
    id: number | string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.dubaiFactor = factor;
    await this.repo.save(existing);
    this.logger.log(`Category #${id} (${existing.name}) dubai_factor set to ${factor}`);
    return existing;
  }

  async setDubaiFactorByName(
    name: string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.dubaiFactor = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) dubai_factor set to ${factor}`,
    );
    return existing;
  }

  /**
   * Best-effort mapping from an arbitrary product title to a known category.
   * Walks both:
   *   1. A curated keyword → category map (handles things like
   *      "dress" → "Women Clothing"); and
   *   2. Direct word matches against the category name itself.
   * Strong keywords (product type: sandal, heel, dress, bag, …) win by
   * longest match. Weak keywords (occasion: wedding, bridal, …) are used
   * only when no strong keyword matched. Returns null when no match is found.
   *
   * Gender awareness: when the title contains a men-context word, matches
   * against women-only categories (Dress, Short Dress, Body top, Wedding
   * Dress, Girls* shoes) are suppressed. If a shoe-shape keyword matches
   * under men-context, the result is forced to "Men shoes" so titles like
   * "Men's Penny Loafers ... Driving Shoes" don't fall back to no-match.
   */
  /**
   * Primary category resolver for a free-text product title. Tries the Gemini
   * Flash classifier first (when configured) and falls back to the keyword
   * matcher on any miss, so behaviour degrades gracefully without an API key
   * or network. Use this from product/order flows; `findBestMatchByText`
   * remains the pure keyword fallback.
   */
  async findBestCategory(text: string): Promise<Category | null> {
    if (!text) return null;

    if (this.categoryAi.isEnabled()) {
      const all = await this.findAll();
      const names = all.map((c) => c.name);
      const aiName = await this.categoryAi.classify(text, names);
      if (aiName) {
        const match = all.find((c) => c.name === aiName);
        if (match) return match;
      }
    }

    return this.findBestMatchByText(text);
  }

  async findBestMatchByText(text: string): Promise<Category | null> {
    if (!text) return null;
    const lower = text.toLowerCase();
    const all = await this.findAll();
    const byName = new Map(all.map((c) => [c.name, c]));

    const menContext = MEN_CONTEXT_REGEX.test(lower);

    if (menContext) {
      let bestShoe: { score: number } | null = null;
      for (const kw of SHOE_KEYWORDS) {
        if (this.wordMatches(lower, kw)) {
          const score = kw.length;
          if (!bestShoe || score > bestShoe.score) bestShoe = { score };
        }
      }
      const menShoes = byName.get('Men shoes');
      if (bestShoe && menShoes) {
        return menShoes;
      }
    }

    let bestStrong: CategoryMatch | null = null;
    let bestWeak: CategoryMatch | null = null;

    const chooseBest = (
      current: CategoryMatch | null,
      cat: Category,
      kw: string,
    ): CategoryMatch => {
      const priority = CATEGORY_PRIORITY[cat.name] ?? 0;
      const score = kw.length;
      const candidate: CategoryMatch = { category: cat, priority, score };
      if (!current) return candidate;
      if (priority > current.priority) return candidate;
      if (priority === current.priority && score > current.score) return candidate;
      return current;
    };

    const weakByCategory = new Map(
      Object.entries(WEAK_KEYWORDS_BY_CATEGORY).map(([name, kws]) => [
        name,
        new Set(kws.map((k) => k.toLowerCase())),
      ]),
    );

    for (const [catName, keywords] of Object.entries(KEYWORD_TO_CATEGORY)) {
      if (menContext && WOMEN_ONLY_CATEGORIES.has(catName)) continue;
      const cat = byName.get(catName);
      if (!cat) continue;
      const weakSet = weakByCategory.get(catName);
      for (const kw of keywords) {
        if (!this.wordMatches(lower, kw)) continue;
        const tier = weakSet?.has(kw.toLowerCase()) ? 'weak' : 'strong';
        if (tier === 'strong') {
          bestStrong = chooseBest(bestStrong, cat, kw);
        } else {
          bestWeak = chooseBest(bestWeak, cat, kw);
        }
      }
    }

    for (const [catName, keywords] of Object.entries(WEAK_KEYWORDS_BY_CATEGORY)) {
      if (menContext && WOMEN_ONLY_CATEGORIES.has(catName)) continue;
      const cat = byName.get(catName);
      if (!cat) continue;
      for (const kw of keywords) {
        if (this.wordMatches(lower, kw)) {
          bestWeak = chooseBest(bestWeak, cat, kw);
        }
      }
    }

    for (const cat of all) {
      if (menContext && WOMEN_ONLY_CATEGORIES.has(cat.name)) continue;
      if (this.wordMatches(lower, cat.name)) {
        bestStrong = chooseBest(bestStrong, cat, cat.name);
      }
    }

    return bestStrong?.category ?? bestWeak?.category ?? null;
  }

  private wordMatches(haystack: string, needle: string): boolean {
    if (!needle) return false;
    const escaped = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  }
}
