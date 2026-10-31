---
name: obsidian-inline-diff
description: Propose reviewable Obsidian Markdown edits with the Inline Diff plugin's addition, deletion, and replacement syntax. Use for pending changes that preserve valid accept and reject outcomes, including tables, lists, callouts, code, and other structural edits. Excludes comment-thread replies.
---

# Inline Diff syntax

Write pending proposals in the note's Markdown body so a human can accept or reject each change. Use the note access tools available in the current environment; this skill requires no particular vault, CLI, operating system, or other installed skill.

## Choose the smallest useful proposal

| Operation | Write | Accept yields | Reject yields |
| --- | --- | --- | --- |
| Addition | `{++new++}` | `new` | Empty |
| Deletion | `{--old--}` | Empty | `old` |
| Replacement | `{~~old~>new~~}` | `new` | `old` |

This syntax is CriticMarkup-inspired.

Use inline proposals for changes wholly inside ordinary text, a table cell, list item, link label, or callout body:

```markdown
The timeout is {~~10~>30~~} seconds.

| Feature | Status |
| --- | --- |
| Export | {~~Planned~>Available~~} |

> [!tip] Recovery
> {++Keep a backup.++}
```

Keep related replacements together and independent edits separate. Several proposals in one Markdown container may share a rendered comparison while retaining separate decisions. Do not add grouping metadata or IDs.

## Wrap complete structures for structural changes

For table rows or columns, list structure, callout types or titles, Markdown delimiters, or edits crossing block boundaries, wrap the smallest **complete container** whose Before and After both render correctly. Include the table header and separator when wrapping a table:

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

Place block-form opening, separator, and closing markers on their own lines at **column zero with no extra spaces**. Put all quote prefixes, list markers, indentation, and fences **inside** each arm. Do not insert block delimiter lines between table rows or after a list/callout prefix.

For a callout type/title change, wrap the complete callout outside its `>` prefixes:

```markdown
{~~
> [!note] Recovery
> Keep a backup.
~>
> [!warning] Before upgrading
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

When Obsidian is available, inspect raw Source and rendered Live Preview comparisons, and check Reading view display for structural edits. Humans review in Source or Live Preview using check/X buttons or command-palette actions. Reading view, embedded notes, and hover previews are display-only. A caret inside a Live Preview comparison can reveal editable source.

Leave proposals pending unless the user explicitly asks for resolution. Report what was proposed and whether visual rendering was checked. This syntax workflow does not require installing or reloading plugins, or resolving other pending changes.
