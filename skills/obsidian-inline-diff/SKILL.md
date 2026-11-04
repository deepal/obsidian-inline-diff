---
name: obsidian-inline-diff
description: Propose reviewable Obsidian Markdown edits with the Inline Diff plugin's addition, deletion, and replacement syntax. Use for pending changes that preserve valid accept and reject outcomes, including tables, lists, callouts, code, and other structural edits. Excludes comment-thread replies and plugin development.
---

# Inline Diff syntax

Write pending proposals in the note's Markdown body so a human can accept or reject each change. Use the note access tools available in the current environment; this skill requires no particular vault, CLI, operating system, or other installed skill.

## Choose the smallest useful proposal

| Operation | Write | Accept yields | Reject yields |
| --- | --- | --- | --- |
| Addition | `{++new++}` | `new` | Empty |
| Deletion | `{--old--}` | Empty | `old` |
| Replacement | `{~~old~>new~~}` | `new` | `old` |

This syntax is CriticMarkup-inspired. The presentation update adds no new delimiters, grouping syntax, IDs, or settings. Continue using the three forms above; `{old | new}` is not this plugin's replacement syntax.

Use inline proposals for changes wholly inside ordinary text, a table cell, list item, link label, or callout title/body:

```markdown
The timeout is {~~10~>30~~} seconds.

| Feature | Status |
| --- | --- |
| Export | {~~Planned~>Available~~} |

> [!tip] Recovery
> {++Keep a backup.++}
```

Each marker defines **one complete stacked Before/After comparison, one approval decision, and one navigation stop**. Differences between words are highlighted automatically within the two arms. A proposal with several changed passages still remains one comparison.

Choose the scope for the human's decision:

- For independent edits in different cells, headings, items or callout passages, surround each affected passage separately. Keep the table separators, list markers, quote prefixes and unchanged context outside those inline markers.
- For a coherent paragraph rewrite, surround the complete paragraph. Both complete paragraphs will appear; do not manually break it into word-sized proposals to obtain highlights.
- A phrase marker shows only that phrase in each panel. The unmarked prefix/suffix appears once, flowing before and after the full-width stacked pair inside its containing structure.
- Surround an entire table, list or callout only when the intended decision covers that whole structure. This intentionally shows complete Before and After structures.

For example, these are five independent decisions in one table, list and callout:

```markdown
| {~~Feature~>Capability~~} | Status |
| --- | --- |
| Export | {~~Planned~>Available~~}; {~~Manual~>Automatic~~} |

- Keep this item unchanged.
- Use a {~~10~>30~~} second timeout.

> [!note] Recovery
> Keep the {~~old~>latest~~} backup.
```

Several proposals can share a native rendering container without sharing their comparison or controls. Multiple markers in one cell remain separate pairs. Do not add numbered selectors, grouping metadata or IDs, and do not wrap a whole container merely because several independent passages changed.

## Wrap complete structures for structural changes

For table rows or columns, list structure, callout types, Markdown delimiters, or edits crossing block boundaries, wrap the smallest **complete container** whose Before and After both render correctly. Include the table header and separator when wrapping a table:

```markdown
{~~
| Feature | Status |
| --- | --- |
| Export | Planned |
~>
| Feature | Status | Owner |
| --- | --- | --- |
| Export | Available | Reviewer |
~~}
```

Place block-form opening, separator, and closing markers on their own lines at **column zero with no extra spaces**. Put all quote prefixes, list markers, indentation, and fences **inside** each arm. Do not put block delimiter lines after a list/callout prefix. Inline edits inside cells and items do not need block form. For a complete row insertion between existing rows, an addition block at column zero can contain the complete new row; preserve the surrounding header, separator and rows, and validate both full-table outcomes. For column or alignment rewrites, include the complete affected table as above.

A text-only callout title edit stays local:

```markdown
> [!note] {~~Recovery~>Recovery before upgrading~~}
> Keep this body unchanged.
```

For a callout **type** change, wrap the complete callout outside its `>` prefixes:

```markdown
{~~
> [!note] Recovery
> Keep a backup.
~>
> [!warning] Recovery
> Keep a backup.
~~}
```

Block additions and deletions use `{++` / `++}` or `{--` / `--}` on their own lines, without a separator:

```markdown
{++
- Verify the backup.
- Start the upgrade.
++}
```

Delimiter lines are removed on resolution. If the closing marker line ends with a newline, the selected arm keeps its final payload line break. If that marker is at EOF without a newline, one final payload line break is removed. Additional payload blank lines remain meaningful. Preserve the note's LF/CRLF, BOM, and final-newline state; never trim the whole note as cleanup.

For formatting changes, include the affected delimiters in the proposal, for example `{~~**important**~>_important_~~}`. For destination changes, surround the complete link or embed; label-only changes can stay inside the label. Preserve escaped table pipes (`\|`) and alignment separators. Each arm must be valid in its surrounding Markdown context.

## Code, math, HTML, and other literal constructs

Proposal markers inside inline code, indented/fenced code, math, HTML elements, HTML comments, and `%%` comments are literal text. To propose a change there, wrap the **complete construct from outside**:

````markdown
{~~
```js
const timeout = 10;
```
~>
```js
const timeout = 30;
```
~~}
````

The same rule applies to an entire inline-code span, math expression, HTML element, Mermaid/query/Base fence, or an embed whose destination/options change. Markers typed inside a fence do not create a reviewable proposal. Preserve comment conversations; do not wrap their history as a text proposal when the task is to reply.

## Escape literal delimiters

Outside protected constructs, backslash-escape reserved tokens when they are ordinary text: `\{++`, `\{--`, `\{~~`, `\++}`, `\--}`, `\~~}`, and `\~>`.

```markdown
A literal \{++token\++} remains text.
```

Escaping backslashes remain stored after resolution so text cannot accidentally become a new proposal. Preserve them, and preserve existing Markdown escapes such as table `\|`.

In block form, inline separator/closing punctuation such as `a~>b++}` is literal; complete separator/closing delimiter lines remain reserved. Literal opening tokens still require escaping outside protected constructs. Use block form when inline delimiter punctuation would be awkward.

## Preserve existing work

- Read the current raw note before editing. Keep proposals out of YAML frontmatter; preserve it verbatim for body-only work.
- Copy the original affected range **exactly** into Before, including whitespace, container prefixes, links, block IDs, and footnotes. Put only the requested change in After. Rejection must recover that original range exactly.
- Never nest or overlap proposals. If explicitly revising a pending proposal, retain its original Before and revise its After. Otherwise keep new proposals separate; do not accept, flatten, or rewrite unrelated pending work to make room.
- Preserve existing comments, author labels, thread IDs, and hidden metadata. `%% … %%` review comments and `<comment>` discussions have their own reply formats; neither is an Inline Diff proposal.
- Revalidate the exact occurrence against the latest content immediately before writing. Use an edit path that preserves unsaved human changes and source bytes. If the target changed or is ambiguous, reread and recompute instead of substituting an identical passage elsewhere or replacing every occurrence.

## Verify both outcomes and leave proposals pending

For every newly authored range, verify that rejecting recovers the exact original and accepting produces the intended valid Markdown. For structural edits, check the complete container in both projections and retain document context for references and footnotes. Existing proposals elsewhere must remain unchanged.

When plugin source is available, use `parseNote` from `src/model.ts` to inspect proposal ranges and diagnostics, and its projection/resolution helpers to check both outcomes. Do this on a copy for validation; do not write the resolved projections back to the note. Unclosed, mismatched, nested, or ambiguous proposals are non-actionable. Fix diagnostics introduced by your edit without silently repairing unrelated markup. Regex replacement or delimiter counting alone cannot validate protected constructs and multiline boundaries.

When Obsidian is available, inspect raw Source and rendered Live Preview comparisons, and check Reading view display for structural edits. Humans review in Source or Live Preview using the floating check/X controls shown on hover or keyboard focus, or the command-palette actions. Each pair owns its controls; there are no numbered shared-block selectors. Source keeps native markers. Live Preview and Reading use the same local Before/After presentation. Full note panes have Previous/Next navigation with wrapping; both arrows are disabled with only one pending proposal. Reading and read-only panes have navigation without mutation controls; embedded notes and hover previews are display-only. A caret inside a Live Preview comparison can reveal editable source.

Leave proposals pending unless the user explicitly asks for resolution. Report what was proposed and whether visual rendering was checked. This syntax workflow does not require installing or reloading plugins, or resolving other pending changes.
