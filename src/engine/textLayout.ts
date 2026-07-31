export interface TextFit {
  fontSize: number;
  lines: string[];
  fits: boolean;
}

function glyphUnits(value: string): number {
  return Array.from(value).reduce((sum, char) => {
    if (/\s/u.test(char)) return sum + 0.32;
    if (/[A-Z0-9]/u.test(char)) return sum + 0.62;
    if (/[^\u0000-\u024f]/u.test(char)) return sum + 0.92;
    return sum + 0.54;
  }, 0);
}

function wrapWords(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (glyphUnits(candidate) * fontSize <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** Deterministic, word-safe fitting shared by render components and gates. */
export function fitTextToBox(
  text: string,
  preferredFontSize: number,
  minFontSize: number,
  maxWidth: number,
  maxHeight: number,
  maxLines = 3,
  lineHeight = 1.22,
): TextFit {
  const minimum = Math.max(8, Math.min(preferredFontSize, minFontSize));
  for (let fontSize = preferredFontSize; fontSize >= minimum; fontSize -= 1) {
    const lines = wrapWords(text, fontSize, maxWidth);
    const widest = Math.max(0, ...lines.map((line) => glyphUnits(line) * fontSize));
    const height = lines.length * fontSize * lineHeight;
    if (lines.length <= maxLines && widest <= maxWidth && height <= maxHeight) {
      return { fontSize, lines, fits: true };
    }
  }
  return { fontSize: minimum, lines: wrapWords(text, minimum, maxWidth), fits: false };
}
