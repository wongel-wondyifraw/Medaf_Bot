import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppConfig } from '../config/configuration';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Marker the model returns when no category fits the title. */
const NONE_TOKEN = 'NONE';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/**
 * Classifies a product title into one of the known catalog categories using
 * Google Gemini Flash. This is a best-effort enhancement: every failure path
 * (disabled, no key, timeout, HTTP error, malformed/unknown answer) returns
 * null so the caller can fall back to keyword matching. Results are cached
 * in-memory per (title + category set) to avoid repeat calls / cost.
 */
@Injectable()
export class CategoryAiService {
  private readonly logger = new Logger(CategoryAiService.name);
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isEnabled(): boolean {
    const g = this.config.get('gemini', { infer: true });
    return g.enabled && !!g.apiKey;
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
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null;

    try {
      const answer = await this.callGemini(cleanTitle, categoryNames);
      const resolved =
        answer && answer !== NONE_TOKEN && validSet.has(answer) ? answer : null;
      this.cache.set(cacheKey, resolved);
      if (resolved) {
        this.logger.log(`Gemini classified "${cleanTitle}" -> ${resolved}`);
      }
      return resolved;
    } catch (err) {
      const e = err as Error;
      this.logger.warn(
        `Gemini classify failed for "${cleanTitle}" (${e.message}); falling back to keywords`,
      );
      return null;
    }
  }

  private async callGemini(
    title: string,
    categoryNames: string[],
  ): Promise<string | null> {
    const g = this.config.get('gemini', { infer: true });
    const url = `${GEMINI_BASE}/${encodeURIComponent(g.model)}:generateContent`;

    const prompt = this.buildPrompt(title, categoryNames);

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
    return this.parseAnswer(text);
  }

  private buildPrompt(title: string, categoryNames: string[]): string {
    const list = categoryNames.map((n) => `- ${n}`).join('\n');
    return [
      'You classify SHEIN product titles into exactly one delivery category.',
      'Choose the single best category from this list (use the names verbatim):',
      list,
      '',
      'Rules:',
      '- Pick the category matching the actual product TYPE, not the occasion.',
      '  e.g. "Wedding Bride High Heel Sandals" is a heeled shoe, NOT a wedding dress.',
      '- A shoe with any heel/stiletto/wedge/pump wording is a heel shoe, not a flat.',
      `- If nothing fits, respond with "${NONE_TOKEN}".`,
      '',
      `Product title: "${title}"`,
      '',
      'Respond ONLY with strict JSON: {"category": "<exact name or NONE>"}',
    ].join('\n');
  }

  private parseAnswer(text: string): string | null {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as { category?: unknown };
      if (typeof parsed.category === 'string') return parsed.category.trim();
    } catch {
      // Model occasionally wraps JSON in prose; fall through to regex.
      const match = trimmed.match(/"category"\s*:\s*"([^"]*)"/);
      if (match) return match[1].trim();
    }
    return null;
  }
}
