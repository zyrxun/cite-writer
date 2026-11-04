// Citation numbering: IEEE-style numbers assigned by order of first
// appearance in the document; re-citing a source reuses its number; any
// edit to the citation sequence renumbers everything deterministically.
// Pure logic — no Zotero imports.

export interface CitationInstance {
  /** Unique id of the citation marker in the document. */
  anchorId: string;
  /** Zotero item key of the cited source. */
  itemKey: string;
}

export interface RegistryEntry {
  itemKey: string;
  number: number;
  /** How many citation markers cite this source. */
  count: number;
}

/** Numbers keyed by item, in first-appearance order of the sequence. */
export function numbersFromSequence(
  instances: CitationInstance[],
): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const inst of instances) {
    if (!numbers.has(inst.itemKey)) numbers.set(inst.itemKey, next++);
  }
  return numbers;
}

/**
 * Tracks the ordered sequence of citation markers in the document.
 * The UI syncs it from the DOM (handles insertion, deletion and reordering)
 * and reads back authoritative numbers.
 */
export class CitationRegistry {
  private instances: CitationInstance[] = [];
  private anchorCounter = 0;

  reset(): void {
    this.instances = [];
  }

  nextAnchorId(): string {
    return `cw-a${++this.anchorCounter}`;
  }

  /**
   * Insert a citation marker into the sequence. Returns the source's number.
   * Inserting an already-known anchorId is a no-op (idempotent).
   */
  insert(itemKey: string, anchorId: string, beforeAnchorId?: string | null): number {
    if (this.instances.some((i) => i.anchorId === anchorId)) {
      return this.numberFor(itemKey) ?? 1;
    }
    const inst: CitationInstance = { anchorId, itemKey };
    const idx = beforeAnchorId
      ? this.instances.findIndex((i) => i.anchorId === beforeAnchorId)
      : -1;
    if (idx >= 0) this.instances.splice(idx, 0, inst);
    else this.instances.push(inst);
    return this.numberFor(itemKey) ?? 1;
  }

  remove(anchorId: string): void {
    this.instances = this.instances.filter((i) => i.anchorId !== anchorId);
  }

  /**
   * Replace the whole sequence from a DOM scan (duplicates by anchorId are
   * dropped). Returns the renumbered map for all cited sources.
   */
  sync(instances: CitationInstance[]): Map<string, number> {
    const seen = new Set<string>();
    this.instances = instances.filter((i) => {
      if (seen.has(i.anchorId)) return false;
      seen.add(i.anchorId);
      return true;
    });
    return numbersFromSequence(this.instances);
  }

  numberFor(itemKey: string): number | undefined {
    for (const inst of this.instances) {
      if (inst.itemKey === itemKey) return numbersFromSequence(this.instances).get(itemKey);
    }
    return undefined;
  }

  entries(): RegistryEntry[] {
    const numbers = numbersFromSequence(this.instances);
    const counts = new Map<string, number>();
    for (const inst of this.instances) {
      counts.set(inst.itemKey, (counts.get(inst.itemKey) ?? 0) + 1);
    }
    return [...numbers.entries()]
      .map(([itemKey, number]) => ({ itemKey, number, count: counts.get(itemKey) ?? 1 }))
      .sort((a, b) => a.number - b.number);
  }
}
