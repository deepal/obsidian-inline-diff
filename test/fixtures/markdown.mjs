// Expected Markdown is authored independently of the plugin parser/renderer.
// A slot changes visible text within a construct; whole cases change structure.
import { spacingFeatures } from "./rendered-spacing.mjs";
const slots = [
  ["paragraph", "text", "A § sentence."],
  ["soft-break", "text", "First line\nA § sentence."],
  ["hard-break", "text", "First line  \nA § sentence."],
  ...[1,2,3,4,5,6].map(level => [`heading-${level}`, "text", `${"#".repeat(level)} A § heading`]),
  ["setext-one", "text", "A § heading\n============"],
  ["setext-two", "text", "A § heading\n------------"],
  ["bold", "text", "**A § phrase**"], ["italic", "text", "_A § phrase_"],
  ["bold-italic", "text", "***A § phrase***"], ["nested-format", "text", "**A _§_ phrase**"],
  ["strike", "text", "~~A § phrase~~"], ["highlight", "text", "==A § phrase=="],
  ["highlight-colour", "text", "==🔴A § phrase=="],
  ["entities", "text", "Fish &amp; chips: § &lt; 10."],
  ["escaped-format", "text", "\\*Literal\\* § \\_text\\_."],
  ["tag", "text", "#project/§"], ["unicode", "text", "日本語 🙂 café § 🧑🏽‍💻"],
  ["rtl", "text", "مرحبا § שלום"],
  ["currency", "text", "$20 is § and $30."],
  ["spaced-dollar", "text", "$ x § $"],
  ["meaningful-whitespace", "text", "A  §  phrase.  \nNext line."],
  ["markdown-link", "links", "[A § link](Target.md \"Title\")"],
  ["wikilink-alias", "links", "[[Target|A § link]]"],
  ["reference-link", "links", "[A § link][target]\n\n[target]: Target.md \"Title\""],
  ["footnote", "links", "A § statement[^one].\n\n[^one]: A footnote."],
  ["inline-footnote", "links", "A § statement.^[Inline footnote.]"],
  ["list-bullet", "containers", "- A § item\n- Second item"],
  ["list-ordered", "containers", "1. A § item\n2. Second item"],
  ["list-nested", "containers", "- Parent\n  - A § item\n    1. Nested"],
  ["list-multiline", "containers", "- Parent\n\n  A § continuation."],
  ["task-open", "containers", "- [ ] A § task"], ["task-done", "containers", "- [x] A § task"],
  ["quote", "containers", "> A § quote."], ["quote-nested", "containers", "> > A § quote."],
  ["callout", "containers", "> [!note] Title\n> A § callout."],
  ["callout-folded", "containers", "> [!tip]- Folded\n> A § callout."],
  ["callout-expanded", "containers", "> [!tip]+ Expanded\n> A § callout."],
  ["callout-nested", "containers", "> [!note] Outer\n> > [!tip] Inner\n> > A § callout."],
  ["table-cell", "tables", "| A | B |\n| --- | --- |\n| § | Keep |"],
  ["table-header", "tables", "| § | B |\n| --- | --- |\n| Value | Keep |"],
  ["table-aligned", "tables", "| A | B |\n| :--- | ---: |\n| § | Keep |"],
  ["table-no-outer-pipes", "tables", "A | B\n-- | --\n§ | Keep"],
  ["table-escaped-pipes", "tables", "| A | B |\n| --- | --- |\n| [[Target\\|§]] | A\\|B |"],
  ["table-format", "tables", "| A | B |\n| --- | --- |\n| **§** | `code` |"],
  ["table-embed", "tables", "| A | B |\n| --- | --- |\n| § | ![[pixel.png\\|30]] |"],
  ["table-inline-pipe-code", "tables", "| A | B |\n| --- | --- |\n| § | `A\\|B` |"],
  ["list-tab-indent", "containers", "- Parent\n\t- A § item"],
  ["quote-list-code", "containers", "> - A § item\n> - `code`"],
  ["callout-table", "containers", "> [!note] Table\n> | A | B |\n> | --- | --- |\n> | § | keep |"],
  ["table-centred", "tables", "| A | B |\n| :---: | :---: |\n| § | keep |"],
  ["heading-closing-hashes", "text", "### A § heading ###"],
  ["autolink", "links", "<https://example.test/§>"],
  ["bare-url", "links", "https://example.test/§"],
  ["email", "links", "<§@example.test>"],
  ["reference-collapsed", "links", "[§][]\n\n[old]: Target.md\n[new]: Other.md"],
  ["reference-shortcut", "links", "[§]\n\n[old]: Target.md\n[new]: Other.md"],
  ["reference-multiline", "links", "[A § link][id]\n\n[id]:\n <Target.md>\n \"A title\""],
];

const whole = [
  ["paragraphs", "text", "One paragraph.\n\nSecond paragraph.", "One paragraph.\n\nNew paragraph.\n\nSecond paragraph."],
  ["horizontal-rule", "text", "---", "***"],
  ["emoji-graphemes", "text", "👨🏾‍💻", "👩🏻‍🔬"],
  ["link-destination", "links", "[Same label](Target.md)", "[Same label](Other.md)"],
  ["url-reserved-punctuation", "links", "[Before](https://example.test/a~>b++})", "[After](https://example.test/c~>d--})"],
  ["reference-destination", "links", "[Same label][id]\n\n[id]: Target.md", "[Same label][id]\n\n[id]: Other.md"],
  ["wiki-target", "links", "[[Target]]", "[[Other]]"],
  ["heading-link", "links", "[[Target#Section]]", "[[Target#Other]]"],
  ["block-link", "links", "[[Target#^sample]]", "[[Target#^other]]"],
  ["block-id", "links", "A block. ^sample", "A block. ^other"],
  ["footnote-definition", "links", "Text[^one].\n\n[^one]: Before.", "Text[^one].\n\n[^one]: After."],
  ["task-state", "containers", "- [ ] A task", "- [x] A task"],
  ["table-row", "tables", "| A | B |\n| --- | --- |\n| 1 | 2 |", "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"],
  ["table-column", "tables", "| A | B |\n| --- | --- |\n| 1 | 2 |", "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |"],
  ["multiple-tables", "tables", "| A | B |\n| --- | --- |\n| same | same |\n\nBetween.\n\n| C | D |\n| --- | --- |\n| same | same |", "| A | B |\n| --- | --- |\n| same | same |\n\nBetween.\n\n| C | D |\n| --- | --- |\n| same | changed |"],
  ["inline-code", "code", "`before`", "`after`"],
  ["inline-code-backticks", "code", "`` `before` ``", "`` `after` ``"],
  ["code-fence", "code", "```js\nconst value = 1;\n```", "```js\nconst value = 2;\n```"],
  ["code-tilde-fence", "code", "~~~python\nvalue = 1\n~~~", "~~~python\nvalue = 2\n~~~"],
  ["code-long-fence", "code", "````md\n```js\nold\n```\n````", "````md\n```js\nnew\n```\n````"],
  ["code-indented", "code", "    old()", "    new()"],
  ["code-indented-literal-markers", "code", "    {++old literal++}", "    {--new literal--}"],
  ["code-fenced-literal-markers", "code", "```md\n{++old literal++}\n```", "```md\n{--new literal--}\n```"],
  ["mermaid", "code", "```mermaid\nflowchart LR\nA-->B\n```", "```mermaid\nflowchart LR\nA-->C\n```"],
  ["query", "code", "```query\npath:Target\n```", "```query\npath:Other\n```"],
  ["base", "code", "```base\nfilters: 'file.name == \"Target\"'\nviews:\n  - type: table\n    name: Results\n```", "```base\nfilters: 'file.name == \"Other\"'\nviews:\n  - type: table\n    name: Results\n```"],
  ["inline-math", "math-html", "$x^2$", "$x^3$"],
  ["display-math", "math-html", "$$\nx^2 + y^2\n$$", "$$\nx^3 + y^3\n$$"],
  ["math-aligned", "math-html", "$$\n\\begin{aligned}x &= 1\\\\y &= 2\\end{aligned}\n$$", "$$\n\\begin{aligned}x &= 3\\\\y &= 4\\end{aligned}\n$$"],
  ["html-inline", "math-html", "<u>Before</u>", "<u>After</u>"],
  ["html-block", "math-html", "<div>Before</div>", "<div>After</div>"],
  ["html-table", "math-html", "<table><tr><td>Before</td></tr></table>", "<table><tr><td>After</td></tr></table>"],
  ["html-sanitization", "math-html", "<img src=\"pixel.png\" onerror=\"throw Error('unsafe')\">", "<img src=\"pixel.png\" alt=\"Safe\">"],
  ["html-comment", "math-html", "<!-- Before -->", "<!-- After -->"],
  ["obsidian-comment", "math-html", "%% Before %%", "%% After %%"],
  ["obsidian-block-comment", "math-html", "%%\nBefore\n%%", "%%\nAfter\n%%"],
  ["note-embed", "embeds", "![[Target]]", "![[Other]]"],
  ["heading-embed", "embeds", "![[Target#Section]]", "![[Target#Other]]"],
  ["block-embed", "embeds", "![[Target#^sample]]", "![[Target#^other]]"],
  ["wiki-image", "embeds", "![[pixel.png|30]]", "![[pixel.png|60]]"],
  ["markdown-image", "embeds", "![Before](pixel.png)", "![After](pixel.png)"],
  ["audio", "embeds", "![[tone.wav]]", "![[missing.wav]]"],
  ["video", "embeds", "![[clip.webm]]", "![[missing.webm]]"],
  ["pdf", "embeds", "![[sample.pdf#page=1&height=100]]", "![[sample.pdf#page=2&height=140]]"],
  ["canvas", "embeds", "![[sample.canvas]]", "![[other.canvas]]"],
  ["base-embed", "embeds", "![[sample.base]]", "![[other.base]]"],
  ["missing-embed", "embeds", "![[Missing-before]]", "![[Missing-after]]"],
  ["iframe", "math-html", "<iframe src=\"about:blank\" height=\"60\"></iframe>", "<iframe src=\"about:blank#after\" height=\"60\"></iframe>"],
  ["callout-title-only", "containers", "> [!note] Before", "> [!note] After"],
  ["quote-fenced-code", "code", "> ```js\n> old()\n> ```", "> ```js\n> new()\n> ```"],
  ["task-capital-x", "containers", "- [X] Before", "- [ ] After"],
  ["wiki-target-inline", "links", "[[Target]]", "[[Other]]"],
];

const callouts = ["note","abstract","summary","tldr","info","todo","tip","hint","important","success","check","done","question","help","faq","warning","caution","attention","failure","fail","missing","danger","error","bug","example","quote","cite","custom"];
for (const type of callouts) slots.push([`callout-type-${type}`, "containers", `> [!${type}] A § title\n> Body.`]);
for (const [colour, emoji] of [["orange", "🟠"], ["yellow", "🟡"], ["green", "🟢"], ["blue", "🔵"], ["purple", "🟣"]]) slots.push([`highlight-${colour}`, "text", `==${emoji}A § phrase==`]);

export const features = [
  ...spacingFeatures,
  ...slots.map(([id, family, template]) => ({ id, family, template, before: "old", after: "new" })),
  ...whole.map(([id, family, before, after]) => ({ id, family, before, after })),
];

export const markdownFixtures = features.flatMap(feature => ["addition", "deletion", "replacement"].map(operation => {
  const old = operation === "addition" ? "" : feature.before;
  const next = operation === "deletion" ? "" : feature.after;
  const tokens = operation === "addition" ? ["{++", "++}"] : operation === "deletion" ? ["{--", "--}"] : ["{~~", "~~}"];
  const prefix = "Intro.\n\n", suffix = "\n\nTail.\n";
  if (feature.template) {
    const change = tokens[0] + (operation === "replacement" ? `${old}~>${next}` : old || next) + tokens[1];
    return { id: `${feature.id}-${operation}`, feature: feature.id, family: feature.family, operation,
      source: prefix + feature.template.replace("§", change) + suffix,
      before: prefix + feature.template.replace("§", old) + suffix,
      after: prefix + feature.template.replace("§", next) + suffix,
    };
  }
  const change = tokens[0] + "\n" + (operation === "replacement" ? `${old}\n~>\n${next}` : old || next) + "\n" + tokens[1];
  return { id: `${feature.id}-${operation}`, feature: feature.id, family: feature.family, operation,
    source: prefix + change + suffix, before: prefix + old + (old ? "\n" : "") + suffix.slice(1), after: prefix + next + (next ? "\n" : "") + suffix.slice(1),
  };
}));

export const literalFixtures = [
  "`{++literal++}`", "`` `{--literal--}` ``", "```md\n{~~old~>new~~}\n```", "~~~\n{++literal++}\n~~~",
  "    {++literal++}", "$x + {++literal++}$", "$$\n{--literal--}\n$$", "<span>{++literal++}</span>",
  "<!-- {++literal++} -->", "%% {++literal++} %%", "%%\n{~~old~>new~~}\n%%", "\\{++literal++}",
  "> ```md\n> {++literal++}\n> ```", "- Example\n\n  ```md\n  {++literal++}\n  ```",
  "<div><div>Nested</div>{++literal++}</div>",
  '<img alt="1 > 0 {++literal++}">', '<div><div title="</div>">Nested</div>{++literal++}</div>',
  "$x\n{++literal++}$",
];

export const boundaryFixtures = [
  { id: "only-addition", source: "{++new++}", before: "", after: "new" },
  { id: "only-deletion", source: "{--old--}", before: "old", after: "" },
  { id: "only-replacement", source: "{~~old~>new~~}", before: "old", after: "new" },
  { id: "empty-addition", source: "{++++}", before: "", after: "" },
  { id: "empty-deletion", source: "{----}", before: "", after: "" },
  { id: "empty-replacement", source: "{~~~>~~}", before: "", after: "" },
  { id: "empty-block", source: "{++\n++}", before: "", after: "" },
  { id: "adjacent", source: "{++A++}{--B--}{~~C~>D~~}", before: "BC", after: "AD" },
  { id: "leading-rule", source: "---\n{++body++}", before: "---\n", after: "---\nbody" },
  { id: "frontmatter", source: '---\nliteral: "{++unchanged++}"\n---\n{~~old~>new~~}', before: '---\nliteral: "{++unchanged++}"\n---\nold', after: '---\nliteral: "{++unchanged++}"\n---\nnew' },
];
