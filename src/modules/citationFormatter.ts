// CSL rendering via Zotero's own machinery: citeproc (Zotero.Styles /
// Zotero.Cite) for per-entry bibliography text, QuickCopy for the copy
// export. Read-only.

import { getPref } from "../utils/prefs";
import { logError } from "../utils/error";

/**
 * Full bibliography entry text per item, in the item order given
 * (numeric styles number by that order).
 */
export async function getEntryCitations(
  itemIDs: number[],
  styleID: string,
): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  if (!itemIDs.length) return texts;
  try {
    const style =
      Zotero.Styles.get(styleID) || Zotero.Styles.get(getPref("style"));
    if (!style) return texts;
    const cslEngine = style.getCiteProc(Zotero.locale, "text", { cache: true });
    cslEngine.updateItems(itemIDs);
    const bibliography = cslEngine.makeBibliography();
    const entries = bibliography?.[0]?.entries ?? [];
    const entryIDs = bibliography?.[0]?.entry_ids ?? [];
    entries.forEach((text: string, i: number) => {
      for (const id of entryIDs[i] ?? []) texts.set(id, String(text).trim());
    });
  } catch (e) {
    logError(e);
  }
  return texts;
}

/** Styled bibliography text for the whole cited list, for clipboard export. */
export function quickCopyBibliography(items: Zotero.Item[]): string {
  const result = Zotero.QuickCopy.getContentFromItems(
    items,
    `bibliography=${getPref("style")}`,
    null,
    false,
  );
  if (typeof result === "string") return result;
  return result?.text ?? "";
}

export interface StyleInfo {
  id: string;
  name: string;
}

export function getVisibleStyles(): StyleInfo[] {
  try {
    return Zotero.Styles.getVisibleStyles().map((style: any) => ({
      id: style.styleID,
      name: style.title,
    }));
  } catch (e) {
    logError(e);
    return [];
  }
}
