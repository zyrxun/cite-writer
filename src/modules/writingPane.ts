// The "Writing" tab: editor pane, sentence matching, suggestion bar with
// one-click [n] insertion, and the auto-renumbered reference side panel.
// All UI lives inside the tab's container, so closing the tab destroys it;
// anything registered globally (notifier, prefs) is cleaned up in hooks.

import { config } from "../../package.json";
import { ElementProps } from "zotero-plugin-toolkit";
import { MatchCandidate, SearchableItem } from "../matching/engine";
import { sentenceContext } from "../matching/sentences";
import { CitationRegistry } from "../numbering/registry";
import { getEntryCitations, quickCopyBibliography } from "./citationFormatter";
import { SearchSession } from "./searchSession";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { logError } from "../utils/error";

const DEBOUNCE_MS = 1500;
const SENTENCE_END_DEBOUNCE_MS = 400;
const MAX_CANDIDATES = 5;

interface PaneElements {
  container: XUL.Box;
  editor: HTMLDivElement;
  suggestions: HTMLDivElement;
  status: HTMLDivElement;
  refList: HTMLDivElement;
}

interface PaneState {
  win: Window;
  els: PaneElements;
  registry: CitationRegistry;
  session: SearchSession;
  debounce: number | undefined;
  savedRange: Range | null;
  lastCandidates: MatchCandidate[];
  matching: boolean;
}

const CITE_SPAN_CLASS = "cw-cite";

function make(doc: Document, props: ElementProps): HTMLElement {
  return ztoolkit.UI.createElement(doc, "div", {
    tag: "div",
    ...props,
  } as any) as HTMLElement;
}

export class WritingPane {
  private state: PaneState | null = null;

  constructor(private win: Window) {}

  /** Build the tab UI inside the container returned by Zotero_Tabs.add(). */
  register(container: XUL.Box, session: SearchSession): void {
    const doc = this.win.document;
    const editor = make(doc, {
      classList: ["cw-editor"],
      properties: { contentEditable: "true" } as unknown as Record<
        string,
        unknown
      >,
      styles: {
        flex: "1",
        overflowY: "auto",
        padding: "12px 16px",
        outline: "none",
        fontSize: "15px",
        lineHeight: "1.6",
        background: "white",
        color: "black",
      },
      listeners: [
        { type: "input", listener: () => this.onInput() },
        { type: "keyup", listener: () => this.saveCaret() },
        { type: "mouseup", listener: () => this.saveCaret() },
        {
          type: "keydown",
          listener: (e: Event) => {
            const ke = e as KeyboardEvent;
            if (ke.ctrlKey && ke.altKey && ke.key.toLowerCase() === "c") {
              ke.preventDefault();
              void this.runMatch();
            }
          },
        },
      ],
    }) as HTMLDivElement;

    const status = make(doc, {
      classList: ["cw-status"],
      styles: { opacity: "0.65", fontSize: "12px", margin: "4px 16px" },
    }) as HTMLDivElement;

    const suggestions = make(doc, {
      classList: ["cw-suggestions"],
      styles: {
        maxHeight: "220px",
        overflowY: "auto",
        borderTop: "1px solid var(--material-border, #ddd)",
        padding: "6px 16px",
      },
    }) as HTMLDivElement;

    const refList = make(doc, {
      classList: ["cw-reflist"],
      styles: {
        flex: "1",
        overflowY: "auto",
        padding: "8px 12px",
        fontSize: "13px",
      },
    }) as HTMLDivElement;

    const refHeader = make(doc, {
      styles: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--material-border, #ddd)",
      },
      children: [
        {
          tag: "label",
          properties: { textContent: getString("cw-references") },
          styles: { fontWeight: "600" },
        },
      ],
    }) as HTMLDivElement;

    const copyBtn = this.win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    copyBtn.textContent = getString("cw-copy-references");
    copyBtn.addEventListener("click", () => void this.copyReferences());
    refHeader.appendChild(copyBtn);

    const left = make(doc, {
      styles: {
        display: "flex",
        flexDirection: "column",
        flex: "1",
        minWidth: "0",
      },
    }) as HTMLDivElement;
    const titleLabel = make(doc, {
      properties: { textContent: getString("cw-tab-title") },
      styles: { padding: "6px 16px", fontWeight: "600" },
    }) as HTMLDivElement;

    const findBtn = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    );
    findBtn.textContent = getString("cw-find-citation");
    findBtn.addEventListener("click", () => void this.runMatch());
    const toolbar = make(doc, {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 16px",
      },
    }) as HTMLDivElement;
    toolbar.appendChild(findBtn);

    left.append(titleLabel, toolbar, editor, status, suggestions);

    const right = make(doc, {
      styles: {
        display: "flex",
        flexDirection: "column",
        width: "340px",
        borderLeft: "1px solid var(--material-border, #ddd)",
      },
    }) as HTMLDivElement;
    right.append(refHeader, refList);

    const root = make(doc, {
      classList: ["cw-root"],
      styles: { display: "flex", height: "100%", minHeight: "0" },
    }) as HTMLDivElement;
    root.append(left, right);
    container.appendChild(root);

    this.state = {
      win: this.win,
      els: { container, editor, suggestions, status, refList },
      registry: new CitationRegistry(),
      session,
      debounce: undefined,
      savedRange: null,
      lastCandidates: [],
      matching: false,
    };
    this.setStatus(getString("cw-status-idle"));
  }

  destroy(): void {
    const state = this.state;
    if (!state) return;
    this.state = null;
    if (state.debounce !== undefined) state.win.clearTimeout(state.debounce);
    state.els.container.querySelector(".cw-root")?.remove();
  }

  private setStatus(text: string): void {
    if (this.state) this.state.els.status.textContent = text;
  }

  private saveCaret(): void {
    const state = this.state;
    if (!state) return;
    const sel = state.win.getSelection();
    if (
      sel &&
      sel.rangeCount &&
      state.els.editor.contains(sel.getRangeAt(0).startContainer)
    ) {
      state.savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  private onInput(): void {
    const state = this.state;
    if (!state) return;
    this.saveCaret();
    // Deletion of citation markers must renumber the rest.
    this.syncCitationsFromDom();
    if (getPref("triggerMode") !== "manual") {
      const text = state.els.editor.textContent ?? "";
      const typedSentenceEnd = /[.!?]\s*$/.test(text);
      this.scheduleMatch(
        typedSentenceEnd ? SENTENCE_END_DEBOUNCE_MS : DEBOUNCE_MS,
      );
    }
  }

  private scheduleMatch(delay: number): void {
    const state = this.state;
    if (!state) return;
    if (state.debounce !== undefined) state.win.clearTimeout(state.debounce);
    state.debounce = state.win.setTimeout(() => {
      state.debounce = undefined;
      void this.runMatch();
    }, delay);
  }

  /** Extract current + previous sentence around the caret and match. */
  private async runMatch(): Promise<void> {
    const state = this.state;
    if (!state) return;
    if (state.matching) {
      // A search is in flight; retry shortly so the latest sentence still runs.
      this.scheduleMatch(300);
      return;
    }
    const editor = state.els.editor;
    const sel = state.win.getSelection();
    let caret = -1;
    if (
      sel &&
      sel.rangeCount &&
      editor.contains(sel.getRangeAt(0).startContainer)
    ) {
      const range = sel.getRangeAt(0).cloneRange();
      range.selectNodeContents(editor);
      range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      caret = range.toString().length;
    } else if (
      state.savedRange &&
      editor.contains(state.savedRange.startContainer)
    ) {
      const range = state.savedRange.cloneRange();
      range.selectNodeContents(editor);
      range.setEnd(state.savedRange.endContainer, state.savedRange.endOffset);
      caret = range.toString().length;
    }
    if (caret < 0) {
      this.setStatus(getString("cw-status-click-in-text"));
      return;
    }
    const text = editor.textContent ?? "";
    const { current, previous } = sentenceContext(text, caret);
    if (!current) {
      this.setStatus(getString("cw-status-idle"));
      this.renderSuggestions([]);
      return;
    }
    state.matching = true;
    this.setStatus(getString("cw-status-searching"));
    try {
      const minScore = Number(getPref("minScore")) || 0;
      const candidates = await state.session.rank(current, previous, {
        maxCandidates: MAX_CANDIDATES,
        minScore,
      });
      if (this.state !== state) return; // pane destroyed while searching
      state.lastCandidates = candidates;
      this.renderSuggestions(candidates);
      this.setStatus(
        candidates.length
          ? `${candidates.length} ${getString("cw-status-results")}`
          : getString("cw-no-candidates"),
      );
    } catch (e) {
      logError(e);
      if (this.state === state) this.setStatus(getString("cw-status-error"));
    } finally {
      state.matching = false;
    }
  }

  private renderSuggestions(candidates: MatchCandidate[]): void {
    const state = this.state;
    if (!state) return;
    const { suggestions } = state.els;
    suggestions.textContent = "";
    const doc = state.win.document;
    const nextNumber = (item: SearchableItem) =>
      state.registry.numberFor(item.key) ?? state.registry.entries().length + 1;

    for (const candidate of candidates) {
      const item = candidate.item;
      const card = doc.createElement("div");
      card.className = "cw-suggestion";
      card.style.cssText =
        "padding:6px 0;border-bottom:1px solid var(--material-border,#eee)";

      const head = doc.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:8px";
      const btn = doc.createElement("button");
      btn.textContent = `${getString("cw-insert")} [${nextNumber(item)}]`;
      btn.addEventListener("click", () => this.insertCitation(candidate));
      head.appendChild(btn);

      const meta = doc.createElement("span");
      meta.textContent = `${item.creators || getString("cw-unknown-authors")} (${item.year || "n.d."}). ${item.title} · ${candidate.score.toFixed(1)}`;
      meta.style.cssText = "font-weight:600;font-size:13px";
      head.appendChild(meta);
      card.appendChild(head);

      const snippet = doc.createElement("div");
      snippet.style.cssText =
        "font-style:italic;margin:4px 0 0 2px;font-size:12px";
      const channel =
        candidate.snippet.channel === "annotations"
          ? getString("cw-channel-annotations")
          : candidate.snippet.channel === "fulltext"
            ? getString("cw-channel-fulltext")
            : getString("cw-channel-metadata");
      snippet.textContent = `“${candidate.snippet.text}” — ${channel}${candidate.snippet.page ? ` ${getString("cw-page", { args: { page: candidate.snippet.page } })}` : ""}`;
      card.appendChild(snippet);
      suggestions.appendChild(card);
    }
  }

  /** Insert the citation marker at the caret and refresh numbering + refs. */
  private insertCitation(candidate: MatchCandidate): void {
    const state = this.state;
    if (!state) return;
    const { editor, suggestions } = state.els;
    const doc = state.win.document;
    const span = doc.createElement("span");
    span.className = CITE_SPAN_CLASS;
    span.dataset.cwKey = candidate.item.key;
    const anchorId = state.registry.nextAnchorId();
    span.dataset.cwAnchor = anchorId;
    span.textContent = `[${state.registry.insert(candidate.item.key, anchorId)}]`;

    const range = state.savedRange ?? doc.createRange();
    if (!editor.contains(range.startContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.collapse(true);
    range.insertNode(span);
    const space = doc.createTextNode(" ");
    range.collapse(false);
    range.insertNode(space);
    // Caret continues after the citation.
    const sel = state.win.getSelection();
    const after = doc.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    state.savedRange = after.cloneRange();

    this.syncCitationsFromDom();
    suggestions.textContent = "";
    this.setStatus(getString("cw-status-inserted"));
    void this.renderRefList();
  }

  /** Rebuild registry state from the editor DOM and renumber all markers. */
  private syncCitationsFromDom(): void {
    const state = this.state;
    if (!state) return;
    const spans = [
      ...state.els.editor.querySelectorAll(`span.${CITE_SPAN_CLASS}`),
    ];
    const numbers = state.registry.sync(
      spans.map((s) => ({
        anchorId: (s as HTMLElement).dataset.cwAnchor ?? "",
        itemKey: (s as HTMLElement).dataset.cwKey ?? "",
      })),
    );
    for (const span of spans) {
      const key = (span as HTMLElement).dataset.cwKey ?? "";
      const number = numbers.get(key);
      if (number !== undefined) span.textContent = `[${number}]`;
    }
  }

  private async renderRefList(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const { refList } = state.els;
    const doc = state.win.document;
    const entries = state.registry.entries();
    refList.textContent = "";
    if (!entries.length) {
      refList.textContent = getString("cw-references-empty");
      return;
    }
    const itemIDs = entries
      .map((e) => state.session.itemID(e.itemKey))
      .filter((id): id is number => id !== undefined);
    const texts = await getEntryCitations(itemIDs, String(getPref("style")));
    if (this.state !== state) return;
    for (const entry of entries) {
      const row = doc.createElement("div");
      row.style.cssText = "margin-bottom:8px";
      const numberEl = doc.createElement("strong");
      numberEl.textContent = `[${entry.number}] `;
      row.appendChild(numberEl);
      const itemID = state.session.itemID(entry.itemKey);
      const text = doc.createElement("span");
      text.textContent =
        (itemID !== undefined ? texts.get(itemID) : "") ||
        `${getString("cw-unknown-source")} ${entry.itemKey}`;
      row.appendChild(text);
      refList.appendChild(row);
    }
  }

  private async copyReferences(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const entries = state.registry.entries();
    if (!entries.length) return;
    const itemIDs = entries
      .map((e) => state.session.itemID(e.itemKey))
      .filter((id): id is number => id !== undefined);
    const items = await Zotero.Items.getAsync(itemIDs);
    if (this.state !== state) return;
    // QuickCopy renders the full styled bibliography in the user's CSL style.
    Zotero.Utilities.Internal.copyTextToClipboard(quickCopyBibliography(items));
    this.setStatus(getString("cw-copied"));
  }
}

export const TAB_ID = `${config.addonRef}-tab`;

/** Open (or focus) the Writing tab in a main window. */
export function openWritingTab(
  win: Window,
  session: SearchSession,
  pane: WritingPane,
): void {
  const tabs = (win as unknown as { Zotero_Tabs?: _ZoteroTypes.Zotero_Tabs })
    .Zotero_Tabs;
  if (!tabs) return;
  const existing = tabs.getState().find((t) => t.id === TAB_ID);
  if (existing) {
    tabs.select(TAB_ID);
    return;
  }
  const { container } = tabs.add({
    id: TAB_ID,
    type: config.addonRef,
    title: getString("cw-tab-title"),
    select: false,
    onClose: () => pane.destroy(),
  });
  pane.register(container, session);
}
