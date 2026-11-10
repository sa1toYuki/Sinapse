const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

export const validPin = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{6}$/.test(value);

export function normalizeName(value: unknown) {
  if (typeof value !== 'string' || value.length > 160) return null;
  const name = value.trim().normalize('NFC');
  const count = [...segmenter.segment(name)].length;
  if (count < 2 || count > 20 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(name.replaceAll('\u200d', ''))) return null;
  if (!/[\p{L}\p{N}\p{P}\p{S}]/u.test(name)) return null;
  return { name, nameKey: name.toLowerCase().replaceAll('ς', 'σ').normalize('NFC') };
}
