import MarkdownIt from "markdown-it";

export interface PresentationContext {
  mode: "live" | "reading";
  requestMeasure?: () => void;
}
const markdown = new MarkdownIt({ html: true });

/** Identify real top-level Markdown tables before moving proposal fragments. */
export function liveTables(root: HTMLElement, source: string): HTMLElement[] {
  const tokens = markdown.parse(source, {});
  const tables = tokens.filter(token => token.type === "table_open");
  const elements = [...root.querySelectorAll<HTMLElement>("table")].filter(table => !table.closest(".internal-embed,.footnotes"));
  if (tables.length === elements.length) return elements.filter((_table, index) => tables[index].level === 0);
  // HTML can introduce additional tables. Only accept unambiguous native block
  // correspondence; never apply editor styles to arbitrary nested HTML tables.
  const blocks = tokens.filter(token => token.map && token.level === 0 && token.type !== "inline");
  const children = [...root.children].filter(element => !element.matches(".footnotes"));
  return blocks.length === children.length ? children.filter((element, index): element is HTMLElement => blocks[index].type === "table_open" && element.tagName === "TABLE") : [];
}

/** Passive native layout hooks, with no editor instances or writing controls. */
export function adaptLiveTables(tables: HTMLElement[]): void {
  for (const table of tables) {
    if (!table.parentElement || table.closest('[data-inline-diff-layout="table"]')) continue;
    const doc = table.ownerDocument;
    const host = doc.createElement("div");
    host.className = "cm-embed-block cm-table-widget markdown-rendered";
    host.dataset.inlineDiffLayout = "table";
    const container = doc.createElement("div");
    container.className = "table-wrapper"; container.dataset.inlineDiffLayout = "container";
    table.before(host); host.append(container); container.append(table);
    table.classList.add("table-editor"); table.dataset.inlineDiffNativeTable = "true";
    for (const cell of table.querySelectorAll<HTMLElement>("th,td")) {
      const owner = cell.closest("table");
      if (owner !== table && !owner?.hasAttribute("data-inline-diff-shell")) continue;
      const content = doc.createElement("div");
      content.className = "table-cell-wrapper"; content.dataset.inlineDiffLayout = "cell";
      content.append(...cell.childNodes); cell.append(content);
    }
  }
}
