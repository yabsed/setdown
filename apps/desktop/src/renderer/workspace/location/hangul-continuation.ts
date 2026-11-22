const leads = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const tails = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const lead = (consonant: string) => String.fromCharCode(0x1100 + leads.indexOf(consonant));

/** Hangul is typed one consonant or vowel at a time, and a consonant typed after a vowel first joins
 * the syllable before it: 무한 passes through 뭏 (무 + ㅎ) on the way. The next vowel takes that
 * consonant as the start of a new syllable. Text ending in such a consonant is therefore also the
 * beginning of the words that continue it, which a search for the text as written does not find.
 *
 * This returns the text with that last consonant written as a leading jamo (뭏 becomes 무 + ᄒ).
 * Once decomposed (NFD), it is a prefix of every continuation (무하, 무한, 무호…). It returns
 * undefined when the text does not end in a consonant that a following vowel would take. */
export function hangulContinuation(text: string): string | undefined {
  const last = text.at(-1) ?? '', code = last.charCodeAt(0), rest = text.slice(0, -1);
  if (leads.includes(last) && last) return rest + lead(last);
  if (code < 0xac00 || code > 0xd7a3) return undefined;
  const tail = tails[(code - 0xac00) % 28];
  if (!tail) return undefined;
  // A double final keeps its first consonant: 핝 (한 + ㅈ) continues as 한 + ᄌ.
  const kept = tails.indexOf(tail.slice(0, -1));
  return rest + String.fromCharCode(code - (code - 0xac00) % 28 + kept) + lead(tail.at(-1)!);
}
