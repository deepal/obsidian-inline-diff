# Markdown coverage matrix

The fixture manifest is `test/fixtures/markdown.mjs`, including synthetic complete-section cases from `test/fixtures/rendered-spacing.mjs`. It contains independently authored original/proposed Markdown. Each feature runs as addition, deletion, and replacement in Source, Live Preview, and Reading: **149 features, 447 proposal fixtures, 1,341 real-app view cases**. Every editable case checks both decisions, the exact saved file, one-step undo, and redo. Reading cases check rich rendering and action exclusion.

| Family | Features | Proposal fixtures | View cases |
| --- | ---: | ---: | ---: |
| Text and formatting | 35 | 105 | 315 |
| Links and references | 20 | 60 | 180 |
| Lists, quotes and callouts | 46 | 138 | 414 |
| Tables | 12 | 36 | 108 |
| Code and generated blocks | 12 | 36 | 108 |
| Math, HTML and comments | 11 | 33 | 99 |
| Embeds | 11 | 33 | 99 |
| Combined block/whitespace layouts | 2 | 6 | 18 |

Native-render comparisons check meaningful DOM structure, Markdown destinations, callout types, table alignment, media options, and footnote structure. The proposal comparisons are projected back into each alternative by selecting complete Before or After arms, unwrapping only their plugin placement shells and highlight spans, and retaining surrounding native structure. Both alternatives retain independent native-render expectations; structural tags, destinations, alignment and media semantics remain checked. Native display controls are excluded. PDF checks use stable embed destinations/options because PDF.js generates asynchronous internal DOM.

## Text and formatting

`paragraph`, `soft-break`, `hard-break`, `heading-1`, `heading-2`, `heading-3`, `heading-4`, `heading-5`, `heading-6`, `setext-one`, `setext-two`, `bold`, `italic`, `bold-italic`, `nested-format`, `strike`, `highlight`, `highlight-colour`, `entities`, `escaped-format`, `tag`, `unicode`, `rtl`, `currency`, `spaced-dollar`, `meaningful-whitespace`, `heading-closing-hashes`, `highlight-orange`, `highlight-yellow`, `highlight-green`, `highlight-blue`, `highlight-purple`, `paragraphs`, `horizontal-rule`, `emoji-graphemes`.

## Links and references

`markdown-link`, `wikilink-alias`, `reference-link`, `footnote`, `inline-footnote`, `autolink`, `bare-url`, `email`, `reference-collapsed`, `reference-shortcut`, `reference-multiline`, `link-destination`, `url-reserved-punctuation`, `reference-destination`, `wiki-target`, `heading-link`, `block-link`, `block-id`, `footnote-definition`, `wiki-target-inline`.

## Lists, quotes and callouts

`list-bullet`, `list-ordered`, `list-nested`, `list-multiline`, `task-open`, `task-done`, `quote`, `quote-nested`, `callout`, `callout-folded`, `callout-expanded`, `callout-nested`, `list-tab-indent`, `quote-list-code`, `callout-table`, `callout-type-note`, `callout-type-abstract`, `callout-type-summary`, `callout-type-tldr`, `callout-type-info`, `callout-type-todo`, `callout-type-tip`, `callout-type-hint`, `callout-type-important`, `callout-type-success`, `callout-type-check`, `callout-type-done`, `callout-type-question`, `callout-type-help`, `callout-type-faq`, `callout-type-warning`, `callout-type-caution`, `callout-type-attention`, `callout-type-failure`, `callout-type-fail`, `callout-type-missing`, `callout-type-danger`, `callout-type-error`, `callout-type-bug`, `callout-type-example`, `callout-type-quote`, `callout-type-cite`, `callout-type-custom`, `task-state`, `callout-title-only`, `task-capital-x`.

## Tables

`table-cell`, `table-header`, `table-aligned`, `table-no-outer-pipes`, `table-escaped-pipes`, `table-format`, `table-embed`, `table-inline-pipe-code`, `table-centred`, `table-row`, `table-column`, `multiple-tables`.

## Code and generated blocks

`inline-code`, `inline-code-backticks`, `code-fence`, `code-tilde-fence`, `code-long-fence`, `code-indented`, `code-indented-literal-markers`, `code-fenced-literal-markers`, `mermaid`, `query`, `base`, `quote-fenced-code`.

## Math, HTML and comments

`inline-math`, `display-math`, `math-aligned`, `html-inline`, `html-block`, `html-table`, `html-sanitization`, `html-comment`, `obsidian-comment`, `obsidian-block-comment`, `iframe`.

## Embeds

`note-embed`, `heading-embed`, `block-embed`, `wiki-image`, `markdown-image`, `audio`, `video`, `pdf`, `canvas`, `base-embed`, `missing-embed`.

## Boundary, safety and integration coverage

`multi-block-spacing` combines headings, paragraphs, formatting, links, inline code, and tight/loose nested lists. `rendered-whitespace` combines nested callouts, tables, fenced/indented code, math, preformatted HTML, line breaks, Unicode and NBSP. Additional geometry checks retain highlight wrappers and compare complete block positions, gaps, dimensions, and wrapping with native rendering. The primary section runs across all four themes, both rendered views, two widths and native/200% line heights.

Ten additional boundary fixtures run through all views: document-only additions/deletions/replacements, empty arms, empty block form, adjacent proposals, a leading horizontal rule, and excluded frontmatter. Literal fixtures cover escaped markers, inline/fenced/indented code, math, HTML, and both comment syntaxes.

The interaction suite covers multiple proposals per container, duplicate text, two documents with identical content, native table-cell editing, settings inputs/reset, unsaved buffers, external file edits with remembered carets inside/outside changes and editor/sidebar focus, direct review without first clicking the editor, native editing/blur transitions, simplified comparisons with hidden-change evidence, changes during an asynchronous read, focus changes, renames with relative images, multiple panes, Reading shortcuts and clicks, embedded notes and native hover previews, inert Bases, disabled tasks, delayed embeds, folding, scroll/zoom, popouts, unload/reload, and stress fixtures.

Theme checks run Default, Primary, Minimal, and Blue Topaz in light/dark palettes across all three views. Hover measurements compare text and table bounds plus scroll dimensions, with a 0.5 CSS pixel limit.

See [the test report](test-report.md) for the actual versions, results, artifact hashes, performance measurements, and reviewed screenshots. Third-party plugin languages and mobile devices are outside this core desktop matrix.

## Granular rendering

`test/unified.test.mjs` and `scripts/obsidian-granular.mjs` add source-identity and real-host cases for eight separate cell proposals, repeated cell text, header changes, several proposals in one cell, table alignment, escaped pipes, inline code/formatting/links, multiple tables, row/column rewrites, independent row/cell decisions, twelve-column horizontal navigation, distant ordered/nested/task-list items, callout titles/bodies, nested folded callouts with tables and code, adjacent Unicode/RTL proposals, invisible destinations and local list structures. Every proposal in each editable granular fixture verifies both choices, independently captured source identity, exact saved bytes, one-step undo and redo. Ordered-list fixtures assert that resolving a nested item does not renumber another item. The eight-cell case navigates to eight distinct cells and then outside the table.

Source, Live Preview and Reading navigation cover 0, 1, 2, 8 and 12 proposals, external count transitions, cancellation, splits, popouts and unchanged selection/history. A multi-passage proposal has one decision and one navigation stop. Ambiguous attribution is rejected rather than redirected to another occurrence of the text.

Third-party renderer output has no general compatibility guarantee: arbitrary asynchronous DOM rewrites may invalidate a source mapping. Core families above retain native rendering and sanitization; generated Bases/iframe content stays inert. The fixture suite verifies stable PDF destinations/options rather than PDF.js's transient internal tree. Minimum-version and mobile-device testing are separate from the recorded desktop runtime.


## Proposal presentation assertions

Complete paragraph proposals retain two complete rendered paragraphs, including unchanged words in both. Phrase proposals retain only the phrase in each panel and surrounding text once. Ordinary cell/header edits use one outer table; whole-table proposals intentionally render two tables. Multiple markers in a cell produce separate stacked pairs; a multi-passage proposal produces one pair and one destination. Explicit unit/component and native-host assertions complement the independent whole-document semantic oracle. Both alternatives remain expanded with accessible Before/After labels and empty-arm placeholders.

## Native styling and CSS overrides

`scripts/obsidian-overrides.mjs` compares actual native notes and pending comparisons in the same view, with independently authored clean Markdown. It never seeds the native reference with styles measured from a comparison. Profiles cover no snippets, the exact current private snippet, the reported percentage-line-height/cell-padding combination, asymmetric padding, font family/size and unitless line height, mode-specific fixed line heights, variables, inherited whitespace, selector specificity, `!important`, and ordinary comparison-panel customization.

Independently specified fixed table columns isolate padding and row-height comparisons from content-dependent column sizing. Every profile runs in Live Preview and Reading with Default, Primary, Minimal and Blue Topaz in both palettes, wide panes, narrow panes at 150% zoom, splits and popouts. Header/cell text, unchanged row height, paragraph/heading/list/callout typography and code are checked against native output. Hover and keyboard focus must move no measured comparison/table bounds by more than 0.5 CSS pixels. Runtime checks toggle, edit and reload snippets without replacing the visible comparison DOM, reload the plugin with snippets enabled, and verify read-only Live Preview retains its native table layout. Personal snippets are read-only inputs; only their hash is retained in public evidence.

The native Live Preview host may leave nested-list tables as source. Such render-only structures use the native Markdown renderer reference rather than pretending an editable table widget exists. Arbitrary third-party renderers and selectors that depend on an exact native ancestor/child tree remain outside a general compatibility guarantee. The adapter does not instantiate native table editors within pending comparisons; existing active-cell and ordinary native editing tests remain required.

## Hidden comments and following content

`test/comment-spacing.test.mjs` covers exact separator ranges, closed versus unclosed/escaped comments, frontmatter, code, math, HTML literals, tabs, Unicode, NBSP, hard breaks, visible prefixes/suffixes, proposal-arm whitespace, multiple proposals, paragraphs, lists and callouts. Reconstructing either side must retain the original native DOM and text, including the hidden span's raw separator text.

The mandatory `test:obsidian:following:core` runner checks 17 fixture families in Source, Live Preview and Reading, with no snippets, the exact current private snippet, asymmetric padding and increased typography. It includes comments before/after/between cell comparisons, tabs and multiple proposals in one cell. Independently authored native notes verify that following rows, paragraphs, headings, lists, code, tables and callouts retain their content, typography, wrapping and height within 0.5 CSS pixels. Before any decision, file bytes and undo history must remain unchanged. Every editable fixture then checks each individual accept/reject action, exact saved bytes including comments and following content, and one-step undo/redo.

The separate combined-plugin run enables Inline Review Comments 4.2.2 and retains its failing avatar-containment assertions. Its source-text fallback can place avatars outside the native cell-content wrapper in Live Preview. Inline Diff's spacing correction does not resolve that defect; see [current verification](comment-spacing-testing.md) and the [original investigation](following-content-investigation.md).
