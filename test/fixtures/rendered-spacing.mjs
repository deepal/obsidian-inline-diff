// Synthetic documents authored independently of parser projections.
export const sectionBefore = `## Worker review

**Verdict.** The worker checks for updates every ten seconds and retries twice. Its \`timeout\` is recorded in the [reference](Target.md), so the operator can review failures without losing the surrounding context.

### Current behaviour

- **Timing.** Wait ten seconds before checking again.
- **Retries.** Try twice before stopping.
  - Keep an audit trail.
  - Stop on failure.
- **Results.** Keep the original response.

1. First loose item.

   A second paragraph explains the first step.

2. Another loose item.

The worker closes the connection after processing the response.`;

export const sectionAfter = `## Worker review updated

**Verdict.** The worker checks for updates every thirty seconds and retries four times. Its \`timeout\` is recorded in the [reference](Other.md), so the operator can review temporary failures while retaining the surrounding context.

### Revised behaviour

- **Timing.** Wait thirty seconds before checking again.
- **Retries.** Try four times before stopping.
  - Keep an audit trail.
  - Record a temporary failure.
  - Stop when retries are exhausted.
- **Results.** Keep the revised response.

1. First loose item updated.

   A second paragraph explains the revised first step.

2. Another loose item updated.

The worker closes the connection after processing the revised response.

The final paragraph records the result for review.`;

export const whitespaceBefore = `> [!note] Outer
> First line with **formatting**.
> Second soft line.\x20\x20
> A hard break follows.
>
> > [!tip] Nested
> > Keep \`a  b\` and a non-breaking space A B.

| Setting | Value |
| --- | --- |
| Before | \`a  b\` |

\`\`\`js
const value = "two  spaces";
  indented();

\`\`\`

    indented  code
      next()

Inline $x + y$ and display math

$$
x + y = z
$$

<pre>First  line
  Second line

Last line</pre>

<div style="white-space: pre-wrap">First  line
  Second line</div>

日本語 👩🏻‍🔬 مرحبا A B.`;

export const whitespaceAfter = `> [!warning] Outer updated
> Revised line with **formatting**.
> Another soft line.\x20\x20
> A hard break remains.
>
> > [!tip] Nested updated
> > Keep \`c  d\` and a non-breaking space C D.

| Setting | Value |
| --- | --- |
| After | \`c  d\` |

\`\`\`js
const value = "four    spaces";
    indented();

\`\`\`

    indented    code
        next()

Inline $a + b$ and display math

$$
a + b = c
$$

<pre>Revised  line
    Second line

Last line</pre>

<div style="white-space: pre-wrap">Revised  line
    Second line</div>

日本語 👨🏾‍💻 שלום C D.`;

export const spacingFeatures = [
  { id: "multi-block-spacing", family: "combinations", before: sectionBefore, after: sectionAfter },
  { id: "rendered-whitespace", family: "combinations", before: whitespaceBefore, after: whitespaceAfter },
];
