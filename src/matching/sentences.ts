// Sentence segmentation around the caret. Pure logic, no Zotero imports.

/** Sentence context around the caret: current sentence + previous sentence. */
export function sentenceContext(
  text: string,
  caret: number,
): { current: string; previous: string } {
  const boundary = /[.!?]+/g;
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const ends: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(before))) ends.push(m.index + m[0].length);

  // Caret sits immediately after a sentence end (e.g. the user just typed
  // "."): the just-completed sentence is the current one to match.
  const lastEnd = ends.length ? ends[ends.length - 1] : 0;
  if (ends.length && lastEnd === caret) {
    const prevEnd = ends.length >= 2 ? ends[ends.length - 2] : 0;
    const prevPrevEnd = ends.length >= 3 ? ends[ends.length - 3] : 0;
    return {
      current: text.slice(prevEnd, lastEnd).trim(),
      previous: text.slice(prevPrevEnd, prevEnd).trim(),
    };
  }

  // Otherwise: sentence in progress around the caret.
  const prevEnd = ends.length >= 2 ? ends[ends.length - 2] : 0;
  const next = new RegExp("[.!?]+").exec(after);
  const currentEnd = next ? caret + next.index + next[0].length : text.length;
  return {
    current: text.slice(lastEnd, currentEnd).trim(),
    previous: text.slice(prevEnd, lastEnd).trim(),
  };
}
