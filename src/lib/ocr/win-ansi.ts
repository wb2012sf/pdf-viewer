/**
 * The standard PDF fonts encode text as WinAnsi (CP1252), which cannot
 * represent every character Tesseract might emit. A single unencodable
 * character makes pdf-lib throw for the whole word, so text is folded into
 * CP1252 before it reaches the font.
 *
 * This only ever affects the *invisible* layer. The visible page is the
 * scanned image, so a folded character changes what a search matches, never
 * what the reader sees.
 */

/**
 * Characters worth folding rather than dropping: OCR produces these routinely
 * from ordinary English text, and dropping them would break search for the
 * words they sit inside.
 */
const FOLDED: ReadonlyMap<string, string> = new Map([
  ['‘', "'"], // ‘
  ['’', "'"], // ’
  ['‚', "'"],
  ['“', '"'], // “
  ['”', '"'], // ”
  ['„', '"'],
  ['–', '-'], // en dash
  ['—', '-'], // em dash
  ['―', '-'],
  ['−', '-'], // minus sign
  ['…', '...'], // ellipsis
  [' ', ' '], // non-breaking space
  [' ', ' '],
  [' ', ' '],
  ['•', '*'], // bullet
  ['­', ''], // soft hyphen
  ['ﬁ', 'fi'], // ligatures: Tesseract emits these from scanned print
  ['ﬂ', 'fl'],
  ['ﬀ', 'ff'],
  ['ﬃ', 'ffi'],
  ['ﬄ', 'ffl'],
]);

/** Codepoints CP1252 defines above ASCII but outside Latin-1's contiguous run. */
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function isEncodable(codePoint: number): boolean {
  // Printable ASCII, printable Latin-1, or one of CP1252's extras. Control
  // characters are excluded: they would be encoded happily and then sit in the
  // text layer as junk that search can never match.
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return CP1252_EXTRAS.has(codePoint);
}

/**
 * Folds `text` into something a standard PDF font can encode, dropping only
 * what has no reasonable equivalent.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const char of text) {
    const folded = FOLDED.get(char);
    if (folded !== undefined) {
      out += folded;
      continue;
    }
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isEncodable(codePoint)) {
      out += char;
    }
    // Anything else is dropped: it cannot be encoded, and guessing at a
    // replacement would put a word into the search index that is not on the page.
  }
  return out;
}
