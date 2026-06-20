import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BroadGroup,
  defaultDubaiFactorForGroup,
  resolveBroadGroup,
} from '../calculator/broad-group';
import { AppConfig } from '../config/configuration';
import {
  CategoryNewProposal,
  confidenceMeetsMinimum,
  normalizeCategoryName,
} from './category-ai.shared';
import { CategoryAiService } from './category-ai.service';
import { CategoryLinkContext } from './category-link-context';
import {
  CATEGORY_THREE_FACTOR_SEED,
  readEnvFactorOverride,
  type ThreeFactors,
} from './category-three-factors';
import { CategoryGroqService } from './category-groq.service';
import { Category } from './category.entity';

export type { ThreeFactors };

export type CategoryResolveSource =
  | 'gemini_match'
  | 'gemini_created'
  | 'keyword'
  | 'none';

export interface CategoryResolveOutcome {
  category: Category | null;
  source: CategoryResolveSource;
  created?: boolean;
  peerCategoryName?: string | null;
}

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
    'midi skirt',
    'maxi skirt',
    'mermaid skirt',
    'pleated skirt',
    'skirt',
    'jumpsuit',
    'jumpsuits',
    'jump suit',
    'boilersuit',
    'boiler suit',
    'catsuit',
    'unitard',
    'overall',
    'overalls',
    'dungaree',
    'dungarees',
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
    'romper',
    'rompers',
    'playsuit',
    'playsuits',
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
  Pijamas: [
    'pijama',
    'pijamas',
    'pajama',
    'pajamas',
    'pyjama',
    'pyjamas',
    'sleepwear',
    'nightwear',
    'nightwear set',
    'sleep set',
    'pajama set',
    'pyjama set',
    'pijama set',
    'sleep shirt',
    'sleep pants',
    'sleep shorts',
    'sleep top',
    'sleep bottom',
    'nightgown',
    'night gown',
    'nightdress',
    'night dress',
    'loungewear set',
    'housecoat',
    'sleep romper',
    'sleep onesie',
    'onesie pajama',
    'footed pajama',
    'footed pyjama',
  ],
  Underwear: [
    'underwear',
    'bra',
    'panties',
    'lingerie',
    'thong',
    'brief',
    'boxer',
    'nipple cover',
    'nipple covers',
    'pasties',
    'bra accessory',
    'bra accessories',
    'breast cover',
    'breast covers',
    'sticky bra',
    'adhesive bra',
    'invisible bra',
    'strapless bra',
    'bra pad',
    'bra pads',
    'bra insert',
    'bra inserts',
  ],
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

/** Delivery/pricing category names used to filter the AI prompt list. */
const PRICING_CATEGORY_NAMES = new Set(Object.keys(KEYWORD_TO_CATEGORY));

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
  Underwear: 3,
};

/**
 * Underwear keywords that identify the actual product type (not generic
 * style words). Used to apply Underwear's elevated CATEGORY_PRIORITY.
 */
const UNDERWEAR_PRODUCT_KEYWORDS = new Set(
  [
    'nipple cover',
    'nipple covers',
    'pasties',
    'bra accessory',
    'bra accessories',
    'breast cover',
    'breast covers',
    'sticky bra',
    'adhesive bra',
    'invisible bra',
    'strapless bra',
    'bra pad',
    'bra pads',
    'bra insert',
    'bra inserts',
    'underwear',
    'panties',
    'thong',
    'brief',
    'boxer',
  ].map((k) => k.toLowerCase()),
);

/**
 * Suppresses "wedding dress" / "wedding gown" strong matches when the title
 * describes accessories or supplies for weddings, not an actual dress.
 */
const WEDDING_DRESS_ACCESSORY_CONTEXT =
  /\bwedding\s+(?:dress|gown)\s+(?:accessories|accessory|supplies|supply)\b/i;

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
    private readonly categoryGroq: CategoryGroqService,
    private readonly categoryAi: CategoryAiService,
    private readonly config: ConfigService<AppConfig, true>,
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

  findByNameIgnoreCase(name: string): Promise<Category | null> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(null);
    return this.repo
      .createQueryBuilder('category')
      .where('LOWER(category.name) = LOWER(:name)', { name: trimmed })
      .getOne();
  }

  /**
   * Resolves a product link context via Gemini (match or auto-create), then
   * keyword fallback. Returns source metadata for admin notifications.
   */
  async resolveCategoryForProduct(
    ctx: CategoryLinkContext,
  ): Promise<CategoryResolveOutcome> {
    const title = (ctx.title || '').trim();
    if (!title) return { category: null, source: 'none' };

    const all = await this.findAll();
    const pricingCats = this.filterPricingCategories(all);
    const namesForAi =
      pricingCats.length > 0
        ? pricingCats.map((c) => c.name)
        : all.map((c) => c.name);

    if (this.categoryAi.isEnabled()) {
      const resolved = await this.categoryAi.resolve(ctx, namesForAi);
      if (resolved) {
        const gemini = this.config.get('gemini', { infer: true });

        if (resolved.action === 'match') {
          const match =
            all.find((c) => c.name === resolved.category) ??
            (await this.findByName(resolved.category));
          if (match) {
            return { category: match, source: 'gemini_match' };
          }
        }

        if (
          resolved.action === 'create' &&
          this.categoryAi.isAutoCreateEnabled() &&
          confidenceMeetsMinimum(resolved.confidence, gemini.minConfidence)
        ) {
          const created = await this.createFromAiProposal(
            resolved.newCategory,
            title,
          );
          if (created.category) {
            return {
              category: created.category,
              source: created.created ? 'gemini_created' : 'gemini_match',
              created: created.created,
              peerCategoryName: created.peerCategoryName,
            };
          }
        }
      }
    }

    const keyword = await this.findBestMatchByText(title);
    return {
      category: keyword,
      source: keyword ? 'keyword' : 'none',
    };
  }

  /**
   * Auto-creates a category from a Gemini proposal. Copies shipping/commission
   * from median peers in the same broad group. Returns existing row on dedupe.
   */
  async createFromAiProposal(
    proposal: CategoryNewProposal,
    sourceTitle: string,
  ): Promise<{
    category?: Category;
    error?: 'duplicate' | 'invalid';
    created?: boolean;
    peerCategoryName?: string | null;
  }> {
    const name = normalizeCategoryName(proposal.name);
    if (!name) return { error: 'invalid' };

    const existing = await this.findByNameIgnoreCase(name);
    if (existing) {
      return { category: existing, created: false, peerCategoryName: null };
    }

    const all = await this.findAll();
    const peerCosts = this.medianPeerCosts(proposal.broadGroup, all);

    try {
      const saved = await this.repo.save({
        name,
        shippingCost: peerCosts.shippingCost,
        commissionEtb: peerCosts.commissionEtb,
        dubaiFactor: proposal.dubaiFactorLow,
        dubaiFactorLow: proposal.dubaiFactorLow,
        dubaiFactorAvg: proposal.dubaiFactorAvg,
        dubaiFactorHigh: proposal.dubaiFactorHigh,
        aiCreated: true,
        sourceTitle: sourceTitle.slice(0, 500),
      });
      this.logger.log(
        `AI category created: ${saved.name} (#${saved.id}) ` +
          `factors=${proposal.dubaiFactorLow}/${proposal.dubaiFactorAvg}/${proposal.dubaiFactorHigh} ` +
          `peer=${peerCosts.peerName ?? 'none'}`,
      );
      return {
        category: saved,
        created: true,
        peerCategoryName: peerCosts.peerName,
      };
    } catch (err) {
      const again = await this.findByNameIgnoreCase(name);
      if (again) {
        return { category: again, created: false, peerCategoryName: null };
      }
      throw err;
    }
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
    existing.dubaiFactorLow = factor;
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
    existing.dubaiFactorLow = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) dubai_factor set to ${factor}`,
    );
    return existing;
  }

  async setDubaiFactorLow(
    id: number | string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.dubaiFactorLow = factor;
    existing.dubaiFactor = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category #${id} (${existing.name}) dubai_factor_low set to ${factor}`,
    );
    return existing;
  }

  async setDubaiFactorLowByName(
    name: string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.dubaiFactorLow = factor;
    existing.dubaiFactor = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) dubai_factor_low set to ${factor}`,
    );
    return existing;
  }

  async setDubaiFactorAvg(
    id: number | string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.dubaiFactorAvg = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category #${id} (${existing.name}) dubai_factor_avg set to ${factor}`,
    );
    return existing;
  }

  async setDubaiFactorAvgByName(
    name: string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.dubaiFactorAvg = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) dubai_factor_avg set to ${factor}`,
    );
    return existing;
  }

  async setDubaiFactorHigh(
    id: number | string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    existing.dubaiFactorHigh = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category #${id} (${existing.name}) dubai_factor_high set to ${factor}`,
    );
    return existing;
  }

  async setDubaiFactorHighByName(
    name: string,
    factor: number | null,
  ): Promise<Category | null> {
    const existing = await this.findByName(name);
    if (!existing) return null;
    existing.dubaiFactorHigh = factor;
    await this.repo.save(existing);
    this.logger.log(
      `Category "${name}" (#${existing.id}) dubai_factor_high set to ${factor}`,
    );
    return existing;
  }

  /**
   * Resolves low / avg / high factors for pricing.
   * Priority: DB column → env override → seed table → global defaults.
   */
  async resolveThreeFactors(categoryName: string | null): Promise<ThreeFactors> {
    const pricing = this.config.get('pricing', { infer: true });
    const defaults: ThreeFactors = {
      low: pricing.defaultFactorLow,
      avg: pricing.defaultFactorAvg,
      high: pricing.defaultFactorHigh,
    };

    const seed = categoryName ? CATEGORY_THREE_FACTOR_SEED[categoryName] : null;
    let low = seed?.low ?? defaults.low;
    let avg = seed?.avg ?? defaults.avg;
    let high = seed?.high ?? defaults.high;

    if (categoryName) {
      const cat = await this.findByName(categoryName);
      if (cat?.dubaiFactorLow != null && cat.dubaiFactorLow > 0) {
        low = cat.dubaiFactorLow;
      } else if (cat?.dubaiFactor != null && cat.dubaiFactor > 0) {
        low = cat.dubaiFactor;
      }
      if (cat?.dubaiFactorAvg != null && cat.dubaiFactorAvg > 0) {
        avg = cat.dubaiFactorAvg;
      }
      if (cat?.dubaiFactorHigh != null && cat.dubaiFactorHigh > 0) {
        high = cat.dubaiFactorHigh;
      }
    }

    const envLow = readEnvFactorOverride(process.env, categoryName, 'LOW');
    const envAvg = readEnvFactorOverride(process.env, categoryName, 'AVG');
    const envHigh = readEnvFactorOverride(process.env, categoryName, 'HIGH');

    return {
      low: envLow ?? low,
      avg: envAvg ?? avg,
      high: envHigh ?? high,
    };
  }

  /**
   * Primary category resolver for a free-text product title. Classification
   * order is Groq (primary) -> Gemini (fallback) -> keyword matcher, where
   * each AI step is skipped when not configured and any miss/error falls
   * through to the next step. Use this from product/order flows;
   * `findBestMatchByText` remains the pure keyword fallback.
   */
  async findBestCategory(text: string): Promise<Category | null> {
    if (!text) return null;

    const groqEnabled = this.categoryGroq.isEnabled();
    const geminiEnabled = this.categoryAi.isEnabled();

    if (groqEnabled || geminiEnabled) {
      const all = await this.findAll();
      const names = all.map((c) => c.name);

      if (groqEnabled) {
        const groqName = await this.categoryGroq.classify(text, names);
        const match = groqName && all.find((c) => c.name === groqName);
        if (match) return match;
      }

      if (geminiEnabled) {
        const aiName = await this.categoryAi.classify(text, names);
        const match = aiName && all.find((c) => c.name === aiName);
        if (match) return match;
      }
    }

    return this.findBestMatchByText(text);
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
      let priority = CATEGORY_PRIORITY[cat.name] ?? 0;
      if (
        cat.name === 'Underwear' &&
        UNDERWEAR_PRODUCT_KEYWORDS.has(kw.toLowerCase())
      ) {
        priority = Math.max(priority, CATEGORY_PRIORITY.Underwear ?? 3);
      }
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
        if (this.shouldSkipKeywordMatch(lower, catName, kw)) continue;
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

  /**
   * Drops misleading keyword hits (e.g. "wedding dress" inside "wedding dress
   * accessories" when the product is lingerie, not a gown).
   */
  private shouldSkipKeywordMatch(
    lowerTitle: string,
    categoryName: string,
    keyword: string,
  ): boolean {
    if (categoryName !== 'Wedding Dress') return false;
    const kw = keyword.toLowerCase();
    if (kw !== 'wedding dress' && kw !== 'wedding gown') return false;
    if (WEDDING_DRESS_ACCESSORY_CONTEXT.test(lowerTitle)) return true;
    if (/\b(?:lingerie|nipple|pasties|bra\s+accessories?)\b/i.test(lowerTitle)) {
      return true;
    }
    return false;
  }

  private filterPricingCategories(categories: Category[]): Category[] {
    const filtered = categories.filter(
      (c) =>
        PRICING_CATEGORY_NAMES.has(c.name) ||
        c.shippingCost != null ||
        c.commissionEtb != null,
    );
    return filtered.length > 0 ? filtered : categories;
  }

  private medianPeerCosts(
    broadGroup: BroadGroup,
    all: Category[],
  ): {
    shippingCost: number | null;
    commissionEtb: number | null;
    peerName: string | null;
  } {
    const peers = all.filter((c) => {
      if (resolveBroadGroup(c.name) !== broadGroup) return false;
      return c.shippingCost != null || c.commissionEtb != null;
    });
    if (peers.length === 0) {
      return { shippingCost: null, commissionEtb: null, peerName: null };
    }

    const median = (values: number[]): number | null => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };

    const shippingVals = peers
      .map((c) => c.shippingCost)
      .filter((v): v is number => v != null && v >= 0);
    const commissionVals = peers
      .map((c) => c.commissionEtb)
      .filter((v): v is number => v != null && v >= 0);

    const reference = peers.find(
      (c) => c.shippingCost != null || c.commissionEtb != null,
    );

    return {
      shippingCost: median(shippingVals),
      commissionEtb: median(commissionVals),
      peerName: reference?.name ?? null,
    };
  }
}
