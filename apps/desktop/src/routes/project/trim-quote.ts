const QUOTE_MAX = 560;
const QUOTE_HALF = 260;

export function trimQuoteMiddle(text: string): string {
  if (text.length <= QUOTE_MAX) return text;
  const headCut = text.lastIndexOf(" ", QUOTE_HALF);
  const head = text.slice(0, headCut > 0 ? headCut : QUOTE_HALF).trimEnd();
  const tailStart = text.length - QUOTE_HALF;
  const tailCut = text.indexOf(" ", tailStart);
  const tail = text.slice(tailCut > 0 ? tailCut + 1 : tailStart).trimStart();
  return `${head} … ${tail}`;
}
