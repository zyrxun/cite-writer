# Cite Writer

A Zotero 7 plugin (bootstrapped, no XUL overlays) for drafting literature reviews inside Zotero.
As you write each sentence, Cite Writer finds the sources in your library that the sentence is
drawn from (paraphrases count), shows the top candidates with verbatim evidence, and inserts a
numbered citation like `[3]` at the cursor in one click — while maintaining an auto-generated,
auto-renumbered reference list in your chosen CSL style.

Built from [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
(main branch, targets current Zotero 7).

## What it does

- **Writing tab** — a new tab in the main Zotero window with a rich-text (contenteditable)
  editor and a reference side panel.
- **Sentence matching** — while you type (debounced: ~1.5 s idle, or ~0.4 s after a sentence
  end in auto mode), the current sentence plus the previous sentence are matched against:
  1. **PDF fulltext** via Zotero's built-in full-text index (cache produced by
     `Zotero.Fulltext` — PDFs are never parsed by the plugin),
  2. **Item metadata** (title, abstract, creators, year),
  3. **Your highlights/annotations** (strongest weight, and they carry page numbers).
- **Suggestion bar** — top 5 candidates with authors, year, title, match score, and the
  verbatim snippet (>= 6 shared words) plus page number, so you can verify at a glance.
- **One-click citation** — inserts `[n]` at the cursor (IEEE-style, numbered by order of
  first appearance; re-citing a source reuses its number; deleting a marker renumbers the rest).
- **Reference panel** — full bibliography entries rendered through Zotero's citeproc
  (`Zotero.Styles` / `makeBibliography`), renumbered automatically, with a
  **Copy references** button that exports the styled bibliography via `Zotero.QuickCopy`.
- **Settings** (Zotero Settings → Cite Writer): CSL style picker, trigger mode
  (auto / manual + "Find citation" button + Ctrl+Alt+C), minimum match score,
  search scope (whole user library vs. currently selected collection).

Your library is only ever **read** — items and collections are never modified; the reference
list lives entirely in the plugin's own state.

## Install

1. Grab `cite-writer.xpi` from `.scaffold/build/` (or a release).
2. In Zotero 7: Tools → Plugins → gear icon → "Install Plugin From File" → pick the `.xpi`.
3. Click the **Writing** tab, start drafting.

## Dev workflow

```bash
npm install        # if git+ssh deps are blocked: npm install --allow-git=all
                   # (template dep pulls a git dep; https rewrite via
                   #  git config --global url."https://github.com/".insteadOf "ssh://git@github.com/")
npm run build      # bundles + packs .scaffold/build/cite-writer.xpi, then tsc --noEmit
npm run lint:fix   # prettier + eslint
npm run test:unit  # headless vitest: matching engine, snippet/ngram logic, numbering registry
npm start          # zotero-plugin serve — launches Zotero with the plugin (needs a real Zotero)
```

Tests are pure-logic (no Zotero required): `test/unit/` covers the BM25F-style matching engine
(verify a paraphrased sentence ranks the right source #1 _with_ snippet evidence, including
metadata-only items and a 500-item performance bound), and the citation numbering registry
(first-appearance order, number reuse, renumbering on removal/reorder).

## Architecture

| Module                             | Role                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/matching/text.ts`             | tokenizer (offset-preserving), stopwords, longest shared n-gram snippet finder                                                                                   |
| `src/matching/engine.ts`           | per-channel BM25 index + weighted scoring, snippet-eligible candidates. Pure logic, no Zotero imports                                                            |
| `src/numbering/registry.ts`        | citation sequence → IEEE numbers; `sync()` from a DOM scan handles insert/delete/reorder. Pure logic                                                             |
| `src/modules/corpus.ts`            | builds the searchable corpus from Zotero APIs (read-only), incl. `Zotero.Fulltext` cache files                                                                   |
| `src/modules/searchSession.ts`     | corpus cache per scope + notifier invalidation; the seam where an embeddings/semantic backend could plug in (implement the same `SearchSession.rank()` contract) |
| `src/modules/citationFormatter.ts` | citeproc per-entry bibliography text + QuickCopy export                                                                                                          |
| `src/modules/writingPane.ts`       | the Writing tab UI: editor, caret/sentence tracking, suggestion bar, `[n]` insertion, renumbering, reference panel                                               |
| `src/modules/preferenceScript.ts`  | settings pane wiring                                                                                                                                             |

## What still needs manual testing in Zotero

Automated checks cover lint, types, build, and pure logic. The following can only be verified
inside a running Zotero 7 (with a real library):

- Plugin loads, the Writing tab appears, and startup/shutdown (disable → re-enable) leaves no
  leftover UI or errors.
- Real-PDF corpus build latency on your library (the <1 s target applies to _queries_; the
  one-time corpus build reads `Zotero.Fulltext` caches and may take seconds on large libraries).
- Caret tracking and `[n]` insertion behave across contenteditable edge cases (pasting,
  undo/redo, splitting sentences, deleting markers).
- citeproc reference rendering + QuickCopy "Copy references" with your installed CSL styles.
- Collection-scope matching (`ZoteroPane.getSelectedCollection`).
- Preferences pane controls persist and are picked up by a running editor.
- `Zotero_Tabs` session-restore behavior after a restart with the Writing tab open.

## Known limitations

- Suggestions require a >= 6-word verbatim overlap as evidence, so a heavily paraphrased
  sentence with zero shared word runs won't produce a candidate — that's the spec'd evidence
  rule; a semantic/embedding channel would be the upgrade path (see `SearchSession`).
- The bibliography _numbers shown in the side panel_ are the plugin's first-appearance numbers;
  entry text comes from citeproc. For non-numeric styles the panel's `[n]` prefix is still the
  plugin numbering.
- zh-CN locale is a mirror of the English strings (not translated).
- `repository`/`update_url` in the manifest still point at the template's release channel;
  harmless for local installs, update checks just no-op. Change `package.json` /
  `zotero-plugin.config.ts` before publishing.
- Citation markers track insert/delete/reorder through DOM sync on editor input; heavy edits
  elsewhere (e.g. cutting a block with markers) are picked up on the next input event.

## License

AGPL-3.0-or-later (inherited from the template).
