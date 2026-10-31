# Markdown coverage matrix

The fixture manifest is `test/fixtures/markdown.mjs`. It contains independently authored original/proposed Markdown. Each feature runs as addition, deletion, and replacement in Source, Live Preview, and Reading: **147 features, 441 proposal fixtures, 1,323 real-app view cases**. Every editable case checks both decisions, the exact saved file, one-step undo, and redo. Reading cases check rich rendering and action exclusion.

| Family | Features | Proposal fixtures | View cases |
| --- | ---: | ---: | ---: |
| Text and formatting | 35 | 105 | 315 |
| Links and references | 20 | 60 | 180 |
| Lists, quotes and callouts | 46 | 138 | 414 |
| Tables | 12 | 36 | 108 |
| Code and generated blocks | 12 | 36 | 108 |
| Math, HTML and comments | 11 | 33 | 99 |
| Embeds | 11 | 33 | 99 |

Native-render comparisons check meaningful DOM structure, Markdown destinations, callout types, table alignment, media options, and footnote structure. Marks added by this plugin and native display controls are excluded from comparison. PDF checks use stable embed destinations/options because PDF.js generates asynchronous internal DOM.

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

Ten additional boundary fixtures run through all views: document-only additions/deletions/replacements, empty arms, empty block form, adjacent proposals, a leading horizontal rule, and excluded frontmatter. Literal fixtures cover escaped markers, inline/fenced/indented code, math, HTML, and both comment syntaxes.

The interaction suite covers multiple proposals per container, duplicate text, two documents with identical content, native table-cell editing, settings inputs/reset, unsaved buffers, external file edits with remembered carets inside/outside changes and editor/sidebar focus, direct review without first clicking the editor, native editing/blur transitions, simplified comparisons with hidden-change evidence, changes during an asynchronous read, focus changes, renames with relative images, multiple panes, Reading shortcuts and clicks, embedded notes and native hover previews, inert Bases, disabled tasks, delayed embeds, folding, scroll/zoom, popouts, unload/reload, and stress fixtures.

Theme checks run Default, Primary, Minimal, and Blue Topaz in light/dark palettes across all three views. Hover measurements compare text and table bounds plus scroll dimensions, with a 0.5 CSS pixel limit.

See [the test report](test-report.md) for the actual versions, results, artifact hashes, performance measurements, and reviewed screenshots. Third-party plugin languages and mobile devices are outside this core desktop matrix.
