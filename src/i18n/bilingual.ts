/** English first, then Amharic — standard reseller message format. */
export function bilingual(en: string, am: string): string {
  return `${en}\n\n${am}`;
}

/** Same as bilingual but for HTML blocks (both sides may contain tags). */
export function bilingualHtml(en: string, am: string): string {
  return `${en}\n\n${am}`;
}
