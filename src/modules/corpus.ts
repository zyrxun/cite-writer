// Builds the searchable corpus from the user's library using Zotero's own
// APIs only: metadata fields, the annotations store, and the Zotero.Fulltext
// cache (.zotero-ft-cache, produced by Zotero's PDF indexer — never parsed
// here). Read-only: nothing in this module writes to the library.

import { SearchableItem, TextSegment } from "../matching/engine";
import { getPref } from "../utils/prefs";
import { logError } from "../utils/error";

export interface Corpus {
  items: SearchableItem[];
  /** Zotero item id for each corpus item key (for CSL rendering). */
  itemIDByKey: Map<string, number>;
}

export interface CorpusResult {
  corpus: Corpus;
  scope: string;
}

async function getScopeRegularItems(): Promise<Zotero.Item[]> {
  const scope = getPref("scope");
  const win = Zotero.getActiveZoteroPane();
  if (scope === "collection" && win) {
    const collection = win.getSelectedCollection();
    if (collection) {
      const items = await collection.getChildItems();
      return items.filter((item) => item.isRegularItem());
    }
    // No collection selected: fall through to the whole library.
  }
  return await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true, false);
}

/** Best-effort cached fulltext of the item's best attachment. */
async function collectFulltext(item: Zotero.Item): Promise<TextSegment[]> {
  const segments: TextSegment[] = [];
  try {
    for (const attachment of await item.getBestAttachments()) {
      if (!Zotero.Fulltext.isCachedMIMEType(attachment.attachmentContentType)) {
        continue;
      }
      const path = Zotero.Fulltext.getItemCacheFile(attachment).path;
      const content = await Zotero.File.getContentsAsync(path, "utf-8");
      if (typeof content === "string" && content) {
        segments.push({ text: content });
      }
    }
  } catch (e) {
    // Attachment without a cached/indexed file: fulltext channel stays empty.
    logError(e);
  }
  return segments.filter((s) => s.text);
}

async function collectAnnotations(item: Zotero.Item): Promise<TextSegment[]> {
  const segments: TextSegment[] = [];
  try {
    for (const attachment of await item.getBestAttachments()) {
      for (const ann of attachment.getAnnotations()) {
        const text = [
          ann.getField("annotationText"),
          ann.getField("annotationComment"),
        ]
          .filter(Boolean)
          .join("\n");
        if (text) {
          segments.push({
            text,
            page: ann.getField("annotationPageLabel") || undefined,
          });
        }
      }
    }
  } catch (e) {
    logError(e);
  }
  return segments;
}

export async function collectCorpus(): Promise<CorpusResult> {
  const scope = String(getPref("scope"));
  const items = await getScopeRegularItems();
  const corpusItems: SearchableItem[] = [];
  const itemIDByKey = new Map<string, number>();
  for (const item of items) {
    const key = item.key;
    const title = String(item.getField("title") ?? "");
    const date = String(item.getField("date") ?? "");
    const creators = (item.getCreators?.() ?? [])
      .map((c) =>
        "name" in c
          ? c.name
          : [c.firstName, c.lastName].filter(Boolean).join(" "),
      )
      .join(" ");
    const [annotationSegments, fulltextSegments] = await Promise.all([
      collectAnnotations(item),
      collectFulltext(item),
    ]);
    corpusItems.push({
      itemID: item.id,
      key,
      libraryID: item.libraryID,
      title,
      creators,
      year: date.match(/\d{4}/)?.[0] ?? "",
      abstract: String(item.getField("abstractNote") ?? ""),
      annotationSegments,
      fulltextSegments,
    });
    itemIDByKey.set(key, item.id);
  }
  return { corpus: { items: corpusItems, itemIDByKey }, scope };
}
