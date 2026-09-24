/**
 * Fences content so nothing inside can close the fence: the run of backticks is one longer than
 * any the content contains.
 */
export function fence(content: string, language = ''): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = '`'.repeat(longest + 1);

  return `${ticks}${language}\n${content}\n${ticks}`;
}

/** Inline code that survives backticks in the text, by the same rule as `fence`. */
export function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = '`'.repeat(longest + 1);

  return longest === 0 ? `${ticks}${text}${ticks}` : `${ticks} ${text} ${ticks}`;
}
