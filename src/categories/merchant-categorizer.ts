import { MERCHANT_KEYWORD_RULES } from './taxonomy.generated';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Same keyword rules and word-boundary matching as the mobile MerchantCategorizer. */
const RULES: [RegExp, string][] = MERCHANT_KEYWORD_RULES.map(([keywords, id]) => [
  new RegExp(`(^|[^a-z0-9])(${keywords.split('|').map(escape).join('|')})($|[^a-z0-9])`),
  id,
]);

/** Category for a merchant/description, e.g. "SWIGGY*ORDER" -> food / food.delivery. Null if unknown. */
export function categorizeMerchant(text: string | null | undefined): { categoryId: string; subcategoryId: string | null } | null {
  const t = (text ?? '').toLowerCase().trim();
  if (!t) return null;
  for (const [pattern, id] of RULES) {
    if (pattern.test(t)) {
      const [parent] = id.split('.');
      return { categoryId: parent, subcategoryId: id.includes('.') ? id : null };
    }
  }
  return null;
}
