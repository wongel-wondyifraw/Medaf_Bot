import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../config/configuration';
import {
  buildCategoryPrompt,
  parseCategoryAnswer,
  resolveCategoryAnswer,
} from './category-ai.shared';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Primary category classifier backed by Groq (OpenAI-compatible chat API,
 * generous free tier). Mirrors CategoryAiService semantics: any failure path
 * (disabled, no key, timeout, HTTP error, malformed/unknown answer) returns
 * null so the caller can fall back to Gemini, then keyword matching. Results
 * are cached in-memory per (title + category set) to save quota.
 */
@Injectable()
export class CategoryGroqService {
  private readonly logger = new Logger(CategoryGroqService.name);
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isEnabled(): boolean {
    const g = this.config.get('groq', { infer: true });
    return g.enabled && !!g.apiKey;
  }

  /**
   * Returns the chosen category name (guaranteed to be a member of
   * `categoryNames`) or null when Groq is disabled, errors, or finds no match.
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
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null;

    try {
      const answer = await this.callGroq(cleanTitle, categoryNames);
      const resolved = resolveCategoryAnswer(answer, validSet);
      this.cache.set(cacheKey, resolved);
      if (resolved) {
        this.logger.log(`Groq classified "${cleanTitle}" -> ${resolved}`);
      }
      return resolved;
    } catch (err) {
      const e = err as Error;
      this.logger.warn(
        `Groq classify failed for "${cleanTitle}" (${e.message}); falling back to Gemini`,
      );
      return null;
    }
  }

  private async callGroq(
    title: string,
    categoryNames: string[],
  ): Promise<string | null> {
    const g = this.config.get('groq', { infer: true });
    const prompt = buildCategoryPrompt(title, categoryNames);

    const res = await axios.post<GroqResponse>(
      GROQ_URL,
      {
        model: g.model,
        temperature: 0,
        max_tokens: 30,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      },
      {
        timeout: g.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${g.apiKey}`,
        },
      },
    );

    const text = res.data?.choices?.[0]?.message?.content ?? '';
    return parseCategoryAnswer(text);
  }
}
