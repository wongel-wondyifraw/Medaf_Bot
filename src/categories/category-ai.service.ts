import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../config/configuration';
import {
  buildCategoryPrompt,
  buildCategoryResolvePrompt,
  CategoryResolveResult,
  parseCategoryAnswer,
  parseCategoryResolveAnswer,
  resolveCategoryAnswer,
} from './category-ai.shared';
import {
  categoryLinkContextCacheKey,
  CategoryLinkContext,
} from './category-link-context';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/**
 * Classifies a product title into one of the known catalog categories using
 * Google Gemini Flash. This is a best-effort enhancement: every failure path
 * (disabled, no key, timeout, HTTP error, malformed/unknown answer) returns
 * null so the caller can fall back to the next provider / keyword matching.
 * Results are cached in-memory per (title + category set) to save cost.
 */
@Injectable()
export class CategoryAiService {
  private readonly logger = new Logger(CategoryAiService.name);
  private readonly classifyCache = new Map<string, string | null>();
  private readonly resolveCache = new Map<string, CategoryResolveResult | null>();

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isEnabled(): boolean {
    const g = this.config.get('gemini', { infer: true });
    return g.enabled && !!g.apiKey;
  }

  isAutoCreateEnabled(): boolean {
    const g = this.config.get('gemini', { infer: true });
    return g.autoCreate;
  }

  /**
   * Returns the chosen category name (guaranteed to be a member of
   * `categoryNames`) or null when AI is disabled, errors, or finds no match.
   */
  async classify(
    title: string,
    categoryNames: string[],
  ): Promise<string | null> {
    if (!this.isEnabled()) return null;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle || categoryNames.length === 0) return null;

    const validSet = new Set(categoryNames);
    const cacheKey = `${categoryNames.join('|')}::${cleanTitle.toLowerCase()}`;
    if (this.classifyCache.has(cacheKey)) return this.classifyCache.get(cacheKey) ?? null;

    try {
      const answer = await this.callGeminiClassify(cleanTitle, categoryNames);
      const resolved = resolveCategoryAnswer(answer, validSet);
      this.classifyCache.set(cacheKey, resolved);
      if (resolved) {
        this.logger.log(`Gemini classified "${cleanTitle}" -> ${resolved}`);
      }
      return resolved;
    } catch (err) {
      const e = err as Error;
      this.logger.warn(
        `Gemini classify failed for "${cleanTitle}" (${e.message})`,
      );
      return null;
    }
  }

  /**
   * Resolves a product link context to an existing category match or a new
   * category proposal. Returns null on disable, error, or unparseable response.
   */
  async resolve(
    ctx: CategoryLinkContext,
    categoryNames: string[],
  ): Promise<CategoryResolveResult | null> {
    if (!this.isEnabled()) return null;
    const cleanTitle = (ctx.title || '').trim();
    if (!cleanTitle || categoryNames.length === 0) return null;

    const cacheKey = categoryLinkContextCacheKey(ctx, categoryNames);
    if (this.resolveCache.has(cacheKey)) {
      return this.resolveCache.get(cacheKey) ?? null;
    }

    try {
      const text = await this.callGeminiResolve(ctx, categoryNames);
      const parsed = parseCategoryResolveAnswer(text);
      this.resolveCache.set(cacheKey, parsed);
      if (parsed) {
        this.logger.log(
          `Gemini resolved "${cleanTitle}" -> action=${parsed.action}` +
            (parsed.action === 'match' ? ` category=${parsed.category}` : ''),
        );
      }
      return parsed;
    } catch (err) {
      const e = err as Error;
      this.logger.warn(
        `Gemini resolve failed for "${cleanTitle}" (${e.message})`,
      );
      return null;
    }
  }

  private async callGeminiClassify(
    title: string,
    categoryNames: string[],
  ): Promise<string | null> {
    const g = this.config.get('gemini', { infer: true });
    const url = `${GEMINI_BASE}/${encodeURIComponent(g.model)}:generateContent`;
    const prompt = buildCategoryPrompt(title, categoryNames);

    const res = await axios.post<GeminiResponse>(
      url,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 20,
          responseMimeType: 'application/json',
        },
      },
      {
        params: { key: g.apiKey },
        timeout: g.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return parseCategoryAnswer(text);
  }

  private async callGeminiResolve(
    ctx: CategoryLinkContext,
    categoryNames: string[],
  ): Promise<string> {
    const g = this.config.get('gemini', { infer: true });
    const url = `${GEMINI_BASE}/${encodeURIComponent(g.model)}:generateContent`;
    const prompt = buildCategoryResolvePrompt(ctx, categoryNames);

    const res = await axios.post<GeminiResponse>(
      url,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 120,
          responseMimeType: 'application/json',
        },
      },
      {
        params: { key: g.apiKey },
        timeout: g.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    return res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
}
