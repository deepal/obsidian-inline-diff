# Granular inline rendering verification

Verified on **4 November 2026** with desktop Obsidian **1.15.0**, Electron **43.8.4**, Chromium **150.0.7871.250**, and embedded Node **24.22.1** on macOS. This is a local feature build of 1.3.0, identified as `inline-diff:1.3.0:proposal-comparisons`. Commit, push and remote publication were not performed.

## Results

| Check | Result |
| --- | --- |
| Lint, both type checks, deployment-disabled production build | Passed |
| Unit, component, parser, serialization and packaging tests | 597 passed |
| Full 149-feature Markdown matrix | 1,341 passed |
| Full existing interaction suite | 415 passed |
| Full navigation suite | 67 passed |
| Granular multi-proposal suite | 38 passed |
| Plugin console errors in app suites | 0 |
| Artifact metadata, installed hashes and diff checks | Passed |

All app suites ran unfiltered against identical assets. [Machine-readable evidence](granular-test-evidence.json) retains their individual case names, versions, measurements and hashes. The [coverage matrix](coverage.md) enumerates every supported family and renderer limitations.

The complete proposal sides are selected to reconstruct each alternative and compared with independently authored expected Markdown rendered by Obsidian. Checks retain native structural tags, link destinations, table alignment, callout types, media options and footnotes. Only plugin annotations and nonsemantic native controls are removed. Geometry comparisons normalize HTML formatting separators while preserving meaningful inline/preformatted whitespace, and use equivalent native ancestor and first-child contexts.

## Proposal boundaries and approval

Presentation assertions verify two complete paragraphs for a whole-paragraph marker, phrase-only panels with shared prefix/suffix, two tables for a whole-table marker, and separate stacked pairs in one cell. One multi-passage proposal remains one complete pair. Eight proposals in separate cells render one table and produce eight distinct cell destinations. The next arrow reaches the proposal outside that table. Twelve-column tables verify horizontal reveal and manual horizontal-scroll cancellation in both rendered views. Other cases cover headers, multiple proposals in one cell, repeated text, alignment, escaped pipes, code, formatting, links, multiple tables, row/column rewrites, independent row/cell changes, nested/task/ordered lists, callout titles and bodies, nested folded callouts with tables/code, adjacent Unicode/RTL text, and invisible destinations.

All **45 individual proposals** in the granular fixtures exercise both decisions: **90 exact-byte approval checks**, each with native undo and redo. Expected marker identity and replacement bytes are independently captured by the fixture author. Resolving a nested list item must preserve unrelated numbering. The review transaction bypasses native typing filters that would otherwise renumber another item.

Source keeps its native markers. Live Preview and Reading place one complete, stacked Before/After pair at each marker boundary. Surrounding content appears once; whole marked structures intentionally appear in both sides. No numbered block selectors remain. Multi-passage proposals retain one complete comparison, one decision and one navigation stop. Generated Mermaid/Bases replacements retain their enclosing proposal anchors, and inert frames have a reachable review surface. Hidden changes have visible local evidence.

## Host behaviour and layout

Counts **0, 1, 2, 8 and 12** run in Source, Live Preview and Reading, alongside external count transitions, individual/bulk decisions, undo/redo, stale snapshots, BOM/CRLF and mixed endings. Tests cover unsaved buffers, native table-cell editors, splits, popouts, mode switches, delayed resources, cancellation and unload/reload. Navigation preserves cursor, selection, note contents and undo history.

Default, Primary **2.10.0**, Minimal **9.1.4**, and Blue Topaz **2026102001** run in both palettes. Narrow/wide panes, zoom, native/increased line heights, native structural spacing, and hover geometry retain the **0.5 CSS-pixel** tolerance. The native UI pass additionally inspected representative header, cell, list and callout scenes and exercised pointer/Enter/Space navigation in all three views without changing synthetic note contents.

| Performance fixture | Input p95 | Live rendered | Reading rendered |
| --- | ---: | ---: | ---: |
| Approximately 100 KB / 200 proposals | 7.8 ms | 4 | 10 |
| Approximately 1 MB / 1,000 proposals | 22.8 ms | 3 | 5 |

Source and Live Preview hover p95 were **0.6 ms** and **0.5 ms**. Existing 100 ms input/hover budgets passed; offscreen comparisons stayed virtualized. Rendering remains constant per materialized container rather than once per proposal.

## Local installation

The Notes installation was discovered by manifest ID `inline-diff`; current vault guidance was read. The previous installation was backed up outside the vault. Only `main.js`, `manifest.json` and `styles.css` were copied. Only Inline Diff was reloaded; other plugin instances and local settings were preserved.

Native pointer, Enter and Space checks in the live Notes vault confirmed individual navigation, wraparound, Reading action exclusion and Source markers on existing pending proposals. No approval or rejection was performed. Before/after note-buffer and disk hashes matched. Selection, undo/redo depth, the active view and source scroll position were restored. Loaded identity and installed hashes matched the tested build, which remains enabled.

| Asset | SHA-256 |
| --- | --- |
| `main.js` | `8a3fe7213384fc0e775549ee463ea2f0a3f40a3eed6a64d249f44289d67654e3` |
| `manifest.json` | `af7f4984fca5a80b64480b0ec154ea212c96bb7a43ca95c01d05840157f3a8ae` |
| `styles.css` | `774fcc5b245b2991ec2c512e598903039c963595f56b9c792bd87eff0e968a2f` |

## Agent authoring skill

The bundled `skills/obsidian-inline-diff/SKILL.md` now describes proposal boundaries, local cell/header/list/callout comparisons, coherent paragraph rewrites, whole structural proposals and unchanged syntax. README installation/invocation guidance links to it. Its frontmatter passes the skill validator; 12 documented Markdown examples contain 19 proposals and pass 24 accept/reject projection checks. The repository and five installed/source mirrors have identical skill instructions.

## Reviewed screenshots

Screenshots contain only disposable synthetic notes: [Live Preview](images/granular-live.png), [Reading](images/granular-reading.png), [callout navigation](images/granular-callout.png), and [Source](images/granular-source.png). Personal-vault screenshots and note contents are not included in repository evidence.

Third-party Markdown processors can replace arbitrary DOM and may invalidate a mapping; ambiguous ownership fails closed. Generated Bases/iframe content remains inert, and PDF checks use stable destinations/options rather than transient PDF.js internals. This run did not test mobile or older Obsidian runtimes; the declared minimum version remains unchanged.
