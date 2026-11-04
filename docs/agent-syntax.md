# Agent syntax contract

The portable [agent skill](../skills/obsidian-inline-diff/SKILL.md) gives the authoring workflow and examples. The rendering update introduces no new syntax.

Write proposals directly into the note body. Never wrap or modify YAML frontmatter as a proposal. A proposal must be non-nested and complete.

| Operation | Source | Accept | Reject |
| --- | --- | --- | --- |
| Addition | `{++new++}` | `new` | Empty |
| Deletion | `{--old--}` | Empty | `old` |
| Replacement | `{~~old~>new~~}` | `new` | `old` |

Use small markers for edits inside normal Markdown containers:

```markdown
**The timeout is {~~10~>30~~} seconds.**

| Name | Status |
| --- | --- |
| Export | {~~Planned~>Available~~} |

> [!tip] Recovery
> {++Keep a backup.++}
```

Each marker defines one complete stacked Before/After pair, one approval decision and one navigation stop. Mark a whole paragraph for a paragraph rewrite; both complete paragraphs appear with changed words highlighted automatically. Mark only a phrase for a local phrase comparison, with surrounding text once. Independent markers in the same cell, list or callout remain separate comparisons inside the shared structure. No numbered proposal selectors are needed. Resolving one leaves the others pending.

Use local markers in table headers and callout titles as well as their bodies. Preserve list markers, quote prefixes, table alignment and escaped pipes outside ordinary text proposals. Wrap an entire table/list/callout only when the decision covers that whole structure; it intentionally shows two complete versions.

## Structural changes

Wrap the complete structure when changing table columns, list structure, callout type, formatting delimiters, or multiple blocks:

```markdown
{~~
| Name | Status |
| --- | --- |
| Export | Planned |
~>
| Name | Status | Owner |
| --- | --- | --- |
| Export | Available | Alice |
~~}
```

For a new block:

```markdown
{++
> [!warning] Upgrade
> Keep a backup before continuing.
++}
```

Block-form opening, replacement-separator, and closing markers occupy their own lines. Delimiter lines are removed on resolution. The closing marker's line ending determines whether the selected payload ends with a newline. Preserve any additional payload blank lines deliberately; the plugin never trims surrounding source.

In block form, inline strings such as URL punctuation `a~>b++}` remain literal: only complete separator/closing lines are delimiters. Use block form when inline delimiter punctuation would otherwise need escaping.

Inline markers may contain line breaks, but whole structures should use the explicit block form. Original and proposed structures should each be valid Obsidian Markdown independently.

## Code, math, HTML, and comments

Markers inside literal constructs are ordinary content. Wrap the complete construct to propose a change:

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

The same rule applies to inline code, indented code, math, HTML elements, HTML comments, and `%%` comments. The plugin renders both alternatives using Obsidian and exposes source comparisons when the visual output hides a change.

## Literal delimiters and malformed input

Escape reserved tokens with a backslash when writing them as ordinary text: `\{++`, `\{--`, `\{~~`, `\++}`, `\--}`, `\~~}`, and `\~>`. Escaping backslashes remain in the stored Markdown after resolution, so literal text cannot become a new proposal accidentally. Existing Markdown escapes, including table `\|`, are preserved.

Do not nest proposals. Combine overlapping changes into one replacement around the complete affected structure. Unclosed, mismatched, nested, or ambiguous proposals remain non-actionable and receive diagnostics. Complete the proposal before asking a human to review it.

Agents only write syntax. Human acceptance/rejection belongs to Source or Live Preview. Reading and read-only panes have navigation without mutation controls; embedded previews are display-only. Previous/Next steps through individual proposal pairs and wraps, with both arrows disabled at one pending proposal.
