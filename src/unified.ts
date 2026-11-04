import MarkdownIt from "markdown-it";
import { commentSeparators, type Decision, type ReviewUnit, type Span } from "./model";

const markdown = new MarkdownIt({ html: true });
const owners = new WeakMap<Element, string>();
const registries = new WeakMap<HTMLElement, Map<string, HTMLElement[]>>();
const paired = new WeakMap<HTMLElement, { before: HTMLElement; after: HTMLElement; unit: ReviewUnit }>();
export interface ReviewPlacement { unit: ReviewUnit; context: string[]; before: Range; after: Range; anchor: HTMLElement | null }
export interface ProjectionCapture { source: string; units: ReviewUnit[]; decision: Decision; prefix: string; blocks: Map<string, Range>; padded: Set<number>; text: string; trivia?: Span[] }
const triviaKey = (index: number) => `comment-trivia:${index}`;
const media = ".math,svg,iframe,canvas,.internal-embed,.bases-embed,.bases-view,.mermaid,.block-language-base,.block-language-query,.block-language-mermaid";
const structural = /^(P|DIV|SECTION|H[1-6]|UL|OL|LI|BLOCKQUOTE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|PRE|HR)$/;

export function ownReviewElement(element: HTMLElement, id: string): void {
  owners.set(element, id); element.dataset.inlineDiffId = id; element.classList.add("inline-diff-unit");
}
export function reviewIdentity(element: Element): string | undefined { return owners.get(element); }
function textNodes(root: Node): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, 4), nodes: Text[] = [];
  let node: Node | null; while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}
function offsets(source: string): number[] {
  const values = [0]; for (let at = 0; at < source.length; at++) if (source[at] === "\n") values.push(at + 1); return values;
}
function cleanElements(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(element => !element.closest(".footnotes,.internal-embed,.bases-embed,.bases-view") || element.matches(".internal-embed,.bases-embed,.bases-view"));
}
function sourceBlocks(root: HTMLElement, source: string): { from: number; to: number; node: HTMLElement }[] {
  const lines = offsets(source), tokens = markdown.parse(source, {}), result: { from: number; to: number; node: HTMLElement }[] = [];
  const add = (token: typeof tokens[number], node: HTMLElement) => { if (token.map) result.push({ from: lines[token.map[0]], to: lines[token.map[1]] ?? source.length, node }); };
  const families: [string[], string][] = [
    [["paragraph_open"], "p"], [["heading_open"], "h1,h2,h3,h4,h5,h6"],
    [["bullet_list_open"], "ul"], [["ordered_list_open"], "ol"], [["list_item_open"], "li"],
    [["blockquote_open"], "blockquote,.callout"], [["table_open"], "table"], [["tr_open"], "tr"],
    [["fence", "code_block"], "pre,.mermaid,.block-language-base,.block-language-query,.block-language-mermaid"], [["hr"], "hr"],
  ];
  for (const [types, selector] of families) {
    const selected = tokens.filter(token => token.map && types.includes(token.type) && !token.hidden);
    const nodes = cleanElements(root, selector).filter(node => !types.includes("fence") || !node.parentElement?.closest(selector));
    if (selected.length === nodes.length) selected.forEach((token, index) => add(token, nodes[index]));
  }
  const top = tokens.filter(token => token.map && token.level === 0 && token.type !== "inline");
  const children = [...root.children].filter((element): element is HTMLElement => !element.matches(".footnotes"));
  if (top.length === children.length) top.forEach((token, index) => add(token, children[index]));
  return result;
}
function completeGroup(source: string, unit: ReviewUnit, decision: Decision): boolean {
  const span = decision === "reject" ? unit.before : unit.after;
  return !source.slice(0, span.from).trim() && !source.slice(span.to).trim();
}
function rowArm(unit: ReviewUnit): boolean { return /^[ \t]*(?:>[ \t]*)*\|/.test(unit.proposal.before || unit.proposal.after); }
function collapsedRow(root: HTMLElement, source: string, position: number): Range | null {
  const blocks = sourceBlocks(root, source), table = blocks.filter(block => block.node.tagName === "TABLE" && block.from <= position && block.to >= position).sort((a,b) => a.to - a.from - (b.to - b.from))[0];
  if (!table) return null;
  const rows = blocks.filter(block => block.node.tagName === "TR" && table.node.contains(block.node));
  const next = rows.find(row => row.from >= position), range = root.ownerDocument.createRange();
  if (next) range.setStartBefore(next.node);
  else {
    let body = table.node.querySelector<HTMLElement>("tbody");
    if (!body) { body = root.ownerDocument.createElement("tbody"); body.dataset.inlineDiffGeneratedContainer = "true"; table.node.append(body); }
    range.setStart(body, body.childNodes.length);
  }
  range.collapse(true); return range;
}

/** Locate complete source blocks first; only inline ranges need detached markers. */
export function prepareProjection(root: HTMLElement, source: string, units: ReviewUnit[], decision: Decision, prefix: string, includeTrivia = true): ProjectionCapture {
  const blocks = new Map<string, Range>(), mapped = sourceBlocks(root, source), edits: { from: number; to: number; text: string }[] = [], padded = new Set<number>();
  for (const [index, unit] of units.entries()) {
    let span = decision === "reject" ? unit.before : unit.after;
    // Empty emphasis is literal Markdown. Capture the delimiter context on both
    // sides so a native render can retain that syntactic transition locally.
    if (unit.before.from === unit.before.to || unit.after.from === unit.after.to) {
      const delimiter = /(\*{1,3}|_{1,3}|~~|==)$/.exec(source.slice(0,span.from))?.[0];
      if (delimiter && source.slice(span.to).startsWith(delimiter)) span = { from: span.from - delimiter.length, to: span.to + delimiter.length };
    }
    const tag = /(?:^|[\s(])(#[\p{L}\p{N}_/-]*)$/u.exec(source.slice(0,span.from));
    if (tag) { span = { from: span.from - tag[1].length, to: span.to }; padded.add(index); }
    const left = source.slice(0,span.from), right = source.slice(span.to);
    const angle = /<[^<>\s]*$/.exec(left), close = /^[^<>\s]*>/.exec(right);
    if (angle && close && /https?:|@/.test(angle[0] + source.slice(span.from,span.to) + close[0])) span = { from: span.from - angle[0].length, to: span.to + close[0].length };
    else {
      const url = /https?:\/\/[^<>\s]*$/.exec(left);
      if (url) { span = { from: span.from - url[0].length, to: span.to + (/^[^<>\s]*/.exec(right)?.[0].length ?? 0) }; padded.add(index); }
      else if (!left.endsWith("[[") && left.endsWith("[") && /^\](?:\[\]|(?![[(\]]))/.test(right)) span = { from: span.from - 1, to: span.to + /^\](?:\[\]|(?![[(\]]))/.exec(right)![0].length };
    }
    for (const other of units) if (other !== unit) {
      const range = decision === "reject" ? other.before : other.after;
      if (span.from < range.to && span.to > range.from) throw new Error("Proposal syntax boundaries overlap another proposal.");
    }
    if (units.length === 1 && completeGroup(source, unit, decision)) {
      const range = root.ownerDocument.createRange(); range.selectNodeContents(root); blocks.set(unit.id, range); continue;
    }
    const covered = mapped.filter(block => span.to > span.from && span.from < block.to && span.to > block.from && !source.slice(block.from, span.from).trim() && !source.slice(span.to, block.to).trim());
    const outer = covered.filter(block => !covered.some(other => other.node !== block.node && other.node.contains(block.node)));
    if (outer.length) {
      const range = root.ownerDocument.createRange(); range.setStartBefore(outer[0].node); range.setEndAfter(outer[outer.length - 1].node); blocks.set(unit.id, range); continue;
    }
    if (span.from === span.to && rowArm(unit)) {
      const range = collapsedRow(root, source, span.from); if (range) { blocks.set(unit.id, range); continue; }
    }
    const start = `;${prefix}S${index};${padded.has(index) ? " " : ""}`, end = `${padded.has(index) ? " " : ""};${prefix}E${index};`;
    if (span.from === span.to) {
      const arm = unit.proposal.before || unit.proposal.after;
      const list = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(arm)?.[0];
      const atLineStart = span.from === 0 || source[span.from - 1] === "\n";
      edits.push({ from: span.from, to: span.to, text: list && atLineStart ? `${list}${start}${end}\n` : `${start}${end}` });
    } else edits.push({ from: span.from, to: span.to, text: start + source.slice(span.from, span.to) + end });
  }
  const trivia = (includeTrivia ? commentSeparators(source) : []).filter(range => !units.some(unit => {
    const arm = decision === "reject" ? unit.before : unit.after;
    return arm.from === arm.to ? range.from <= arm.from && range.to >= arm.to : range.from < arm.to && range.to > arm.from;
  }));
  for (const [index, range] of trivia.entries()) {
    const id = units.length + index;
    edits.push({ from: range.from, to: range.to, text: `;${prefix}S${id};${source.slice(range.from, range.to)};${prefix}E${id};` });
  }
  let text = source;
  for (const edit of edits.sort((a,b) => b.from - a.from || b.to - a.to)) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return { source, units, decision, prefix, blocks, padded, text, trivia };
}

function separator(node: Node): boolean {
  return node.nodeType === 3 && /^[\t\n\f\r ]*$/.test(node.textContent ?? "") && !!node.parentElement && (node.parentElement.matches("ul,ol,table,thead,tbody,tfoot,tr,colgroup") || structural.test(node.previousSibling?.nodeName ?? "") || structural.test(node.nextSibling?.nodeName ?? ""));
}
function semantic(node: Node): string {
  if (node.nodeType === 3) return separator(node) ? "" : node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as HTMLElement;
  if (element.matches(".callout-icon,.callout-fold,.copy-code-button")) return element.tagName;
  const attrs = ["href","data-href","data-callout","src","alt","align","type","width","height","title","checked","data-math"].filter(name => element.hasAttribute(name)).map(name => [name, element.getAttribute(name)]);
  if (element.matches(media)) return JSON.stringify([element.tagName, attrs, element.getAttribute("data-math") ?? element.textContent]);
  return JSON.stringify([element.tagName, attrs, [...element.childNodes].map(semantic).join("")]);
}
function elementPath(root: HTMLElement, element: Element): number[] {
  const path: number[] = []; let at = element;
  while (at !== root) { const parent = at.parentElement; if (!parent) throw new Error("Detached source boundary."); path.unshift([...parent.children].indexOf(at)); at = parent; }
  return path;
}
function atPath(root: HTMLElement, path: number[]): HTMLElement {
  let at = root; for (const index of path) { const next = at.children[index] as HTMLElement | undefined; if (!next) throw new Error("Missing source boundary."); at = next; } return at;
}
function transferPoint(original: HTMLElement, marked: HTMLElement, node: Node, offset: number): [Node, number] {
  const parent = node.nodeType === 1 ? node as HTMLElement : node.parentElement!;
  const target = atPath(original, elementPath(marked, parent));
  const children = [...parent.childNodes], boundary = node.nodeType === 1 ? offset : children.indexOf(node as ChildNode);
  const previous = children.slice(0, boundary).reverse().find(child => child.nodeType === 1) as HTMLElement | undefined;
  const following = children.slice(node.nodeType === 1 ? boundary : boundary + 1).find(child => child.nodeType === 1) as HTMLElement | undefined;
  const oldPrevious = previous ? atPath(original, elementPath(marked, previous)) : null;
  const oldFollowing = following ? atPath(original, elementPath(marked, following)) : null;
  const start = previous ? children.indexOf(previous) + 1 : 0;
  const length = children.slice(start, boundary).filter(child => child.nodeType === 3).reduce((sum,child) => sum + (child.textContent?.length ?? 0), 0) + (node.nodeType === 3 ? offset : 0);
  const targetChildren = [...target.childNodes], targetStart = oldPrevious ? targetChildren.indexOf(oldPrevious) + 1 : 0, targetEnd = oldFollowing ? targetChildren.indexOf(oldFollowing) : targetChildren.length;
  let remaining = length;
  for (const child of targetChildren.slice(targetStart, targetEnd)) if (child.nodeType === 3) {
    const size = child.textContent?.length ?? 0;
    if (remaining <= size && (size || !oldFollowing)) return [child, remaining]; remaining -= size;
  }
  if (remaining && !children.slice(start, node.nodeType === 1 ? boundary : boundary + 1).every(separator)) throw new Error("Rendered source offsets changed.");
  return [target, oldFollowing ? targetChildren.indexOf(oldFollowing) : targetEnd];
}

/** Transfer exact live marker boundaries after validating the native DOM. */
export function captureProjection(original: HTMLElement, marked: HTMLElement, capture: ProjectionCapture): Map<string, Range> {
  const expression = new RegExp(`;${capture.prefix}([SE])(\\d+);`, "g"), starts = new Map<string, Range>(), ends = new Map<string, Range>();
  const emptyContainers = new Set<HTMLElement>();
  for (const node of textNodes(marked)) {
    const matches = [...node.data.matchAll(expression)].map(match => {
      const index = Number(match[2]), padded = capture.padded?.has(index);
      return { index: match.index - (padded && match[1] === "E" ? 1 : 0), length: match[0].length + (padded ? 1 : 0), kind: match[1], unit: index };
    });
    for (const match of matches) {
      const unit = capture.units[match.unit], trivia = capture.trivia?.[match.unit - capture.units.length];
      if (!unit && !trivia) throw new Error("Unknown proposal boundary.");
      const key = unit?.id ?? triviaKey(match.unit - capture.units.length);
      const range = marked.ownerDocument.createRange(); range.setStart(node, match.index + (match.kind === "S" ? match.length : 0)); range.collapse(true);
      (match.kind === "S" ? starts : ends).set(key, range);
      if (unit && (unit.before.from === unit.before.to || unit.after.from === unit.after.to)) { const container = node.parentElement?.closest<HTMLElement>("p,li"); if (container) emptyContainers.add(container); }
    }
    for (const match of matches.reverse()) node.deleteData(match.index, match.length);
  }
  for (const element of emptyContainers) if (!element.textContent && !element.querySelector("img,svg,input,iframe,br")) {
    const parent = element.parentElement; element.remove();
    if (parent?.matches("ul,ol") && !parent.children.length) parent.remove();
  }
  original.normalize(); marked.normalize();
  if (semantic(original) !== semantic(marked)) throw new Error("Could not map the proposal to its exact rendered boundaries.");
  const result = new Map(capture.blocks);
  const keys = [...capture.units.map(unit => unit.id), ...(capture.trivia ?? []).map((_range, index) => triviaKey(index))];
  for (const key of keys) if (!result.has(key)) {
    const start = starts.get(key), end = ends.get(key);
    if (!start || !end) throw new Error("Missing proposal boundary.");
    const [startNode,startOffset] = transferPoint(original, marked, start.startContainer, start.startOffset), [endNode,endOffset] = transferPoint(original, marked, end.startContainer, end.startOffset);
    const range = original.ownerDocument.createRange(); range.setStart(startNode,startOffset); range.setEnd(endNode,endOffset); result.set(key,range);
  }
  return result;
}
function fullParagraph(range: Range): HTMLElement | null {
  let parent = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as HTMLElement : range.commonAncestorContainer.parentElement;
  if (!parent?.matches("p")) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(parent); prefix.setEnd(range.startContainer,range.startOffset);
  const suffix = range.cloneRange(); suffix.selectNodeContents(parent); suffix.setStart(range.endContainer,range.endOffset);
  return !prefix.toString() && !suffix.toString() && !range.collapsed ? parent : null;
}
function blockContent(fragment: DocumentFragment): boolean { return !!fragment.querySelector("p,div,section,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,pre,hr"); }
function normalizePlacement(before: Range, after: Range): void {
  const old = fullParagraph(before), next = fullParagraph(after);
  if (old && next) { before.selectNode(old); after.selectNode(next); }
}
function liftBoundary(marker: Comment): void {
  const flow = /^(DIV|SECTION|LI|TD|TH|BLOCKQUOTE|BODY)$/;
  while (marker.parentElement && !flow.test(marker.parentElement.tagName)) {
    const parent = marker.parentElement, clone = parent.cloneNode(false) as HTMLElement;
    while (marker.nextSibling) clone.append(marker.nextSibling);
    parent.after(marker); if (clone.childNodes.length) marker.after(clone);
    if (!parent.childNodes.length) parent.remove();
  }
}
function sideShell(body: HTMLElement, fragment: DocumentFragment, listStart: number | null): void {
  const first = [...fragment.children][0];
  if (first?.matches("tr")) { const table = body.ownerDocument.createElement("table"), tbody = body.ownerDocument.createElement("tbody"); table.dataset.inlineDiffShell = "true"; tbody.dataset.inlineDiffShell = "true"; table.append(tbody); tbody.append(fragment); body.append(table); }
  else if (first?.matches("li")) { const list = body.ownerDocument.createElement(listStart === null ? "ul" : "ol"); list.dataset.inlineDiffShell = "true"; if (listStart !== null) list.setAttribute("start",String(listStart)); list.append(fragment); body.append(list); }
  else body.append(fragment);
}
function listPosition(range: Range): number | null {
  const parent = range.startContainer.nodeType === 1 ? range.startContainer as HTMLElement : range.startContainer.parentElement;
  if (parent?.tagName !== "OL") return null;
  const items = [...parent.children].filter(element => element.tagName === "LI");
  const next = [...parent.childNodes].slice(range.startOffset).find((node): node is Element => node.nodeType === 1 && (node as Element).tagName === "LI");
  return Number(parent.getAttribute("start") ?? 1) + (next ? items.indexOf(next) : items.length);
}

/** Preserve proven native text while removing only its anonymous layout line. */
function wrapCommentTrivia(root: HTMLElement, ranges: Map<string, Range>): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const candidates = [...ranges].filter(([key, range]) => key.startsWith("comment-trivia:") && !range.collapsed && range.startContainer === range.endContainer && range.startContainer.nodeType === 3 && /^[ \t]+$/.test(range.toString()));
  if (!candidates.length) return spans;
  // Splitting text exactly at another live Range's endpoint can move that
  // endpoint to the wrong side of the inserted span. Bookmark verified DOM
  // offsets, never words, and restore proposal boundaries after all splits.
  const point = (node: Node, offset: number) => {
    if (node.nodeType === 3) {
      const parent = node.parentElement!, prefix = root.ownerDocument.createRange();
      prefix.selectNodeContents(parent); prefix.setEnd(node, offset);
      return { parent, text: prefix.toString().length, next: null, previous: null };
    }
    return { parent: node as HTMLElement, text: null, next: node.childNodes[offset] ?? null, previous: node.childNodes[offset - 1] ?? null };
  };
  const bookmarks = new Map([...ranges].map(([key, range]) => [key, { start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset), collapsed: range.collapsed }]));
  const restorePoint = (saved: ReturnType<typeof point>, right: boolean): [Node, number] => {
    if (saved.text === null) {
      const children = [...saved.parent.childNodes];
      return [saved.parent, saved.next?.parentNode === saved.parent ? children.indexOf(saved.next) : saved.previous?.parentNode === saved.parent ? children.indexOf(saved.previous) + 1 : children.length];
    }
    const nodes = textNodes(saved.parent).filter(node => node.length > 0);
    let offset = saved.text;
    for (const [index, node] of nodes.entries()) {
      if (offset < node.length || (offset === node.length && (!right || index === nodes.length - 1))) return [node, offset];
      offset -= node.length;
    }
    return [saved.parent, saved.parent.childNodes.length];
  };
  const restore = (key: string, range: Range) => {
    const saved = bookmarks.get(key)!;
    const start = restorePoint(saved.start, true), end = saved.collapsed ? start : restorePoint(saved.end, false);
    range.setStart(...start); range.setEnd(...end);
  };
  for (const [key, range] of candidates.reverse()) {
    restore(key, range);
    const parent = range.startContainer.parentElement;
    if (!parent || !root.contains(parent) || range.startContainer !== range.endContainer || parent.closest("pre,code,math,mjx-container,svg,.internal-embed,.footnotes")) continue;
    const span = root.ownerDocument.createElement("span");
    range.surroundContents(span); spans.push(span);
  }
  for (const [key, range] of ranges) if (!key.startsWith("comment-trivia:")) restore(key, range);
  return spans;
}

function settleCommentTrivia(root: HTMLElement, spans: HTMLElement[]): void {
  const candidates = new Set(spans);
  const boundary = (span: HTMLElement, direction: "previousSibling" | "nextSibling"): "pair" | "edge" | "text" => {
    for (let node: Node | null = span[direction]; node; node = node[direction]) {
      if (node.nodeType === 8 || (node.nodeType === 3 && /^[ \t]*$/.test(node.textContent ?? ""))) continue;
      if (node.nodeType !== 1) return "text";
      const element = node as HTMLElement;
      if (candidates.has(element)) continue;
      if (paired.has(element)) return "pair";
      if (structural.test(element.tagName)) return "edge";
      return "text";
    }
    return "edge";
  };
  for (const span of spans) {
    if (root.contains(span) && !span.closest(".inline-diff-side-content")) {
      const left = boundary(span, "previousSibling"), right = boundary(span, "nextSibling");
      if (left !== "text" && right !== "text" && (left === "pair" || right === "pair")) {
        span.className = "inline-diff-comment-trivia";
        span.dataset.inlineDiffLayout = "comment-trivia"; span.setAttribute("aria-hidden", "true");
        continue;
      }
    }
    span.replaceWith(...span.childNodes);
  }
}

export function assembleComparisons(before: HTMLElement, after: HTMLElement, units: ReviewUnit[], oldRanges: Map<string, Range>, newRanges: Map<string, Range>): { element: HTMLElement; placements: ReviewPlacement[] } {
  const placements: ReviewPlacement[] = units.map(unit => { const old = oldRanges.get(unit.id), next = newRanges.get(unit.id); if (!old || !next) throw new Error("Missing proposal placement."); normalizePlacement(old,next); return { unit, context: unit.hunks[0]?.beforeLocation.path ?? [], before: old, after: next, anchor: null }; });
  const trivia = [...wrapCommentTrivia(before, oldRanges), ...wrapCommentTrivia(after, newRanges)];
  const fragments = new Map<string, { before: DocumentFragment; after: DocumentFragment; marker: Comment; oldStart: number | null; newStart: number | null; oldItems: number }>();
  for (const placement of [...placements].reverse()) {
    const oldStart = listPosition(placement.before), newStart = listPosition(placement.after), next = placement.after.extractContents(), old = placement.before.extractContents();
    const marker = before.ownerDocument.createComment("Inline Diff proposal placement"); placement.before.insertNode(marker);
    fragments.set(placement.unit.id,{ before: old, after: next, marker, oldStart, newStart, oldItems: [...old.children].filter(element => element.tagName === "LI").length });
  }
  for (const placement of placements) {
    const fragment = fragments.get(placement.unit.id)!, parent = fragment.marker.parentElement!;
    const block = blockContent(fragment.before) || blockContent(fragment.after);
    if (block && !parent.matches("ul,ol,table,thead,tbody,tfoot,tr")) liftBoundary(fragment.marker);
    const host = fragment.marker.parentElement!;
    let proxy: HTMLElement | null = null;
    if (host.matches("thead,tbody,tfoot")) {
      proxy = before.ownerDocument.createElement("tr"); proxy.dataset.inlineDiffProxy = "true";
      const cell = before.ownerDocument.createElement("td"); cell.setAttribute("colspan",String(host.closest("table")?.querySelector("tr")?.children.length ?? 1)); proxy.append(cell);
    } else if (host.matches("ul,ol")) {
      proxy = before.ownerDocument.createElement("li"); proxy.className = "inline-diff-list-proxy"; proxy.dataset.inlineDiffProxy = "true";
      if (fragment.oldStart !== null) proxy.setAttribute("value",String(fragment.oldStart + fragment.oldItems - 1));
    }
    const phrasing = !proxy && host.matches("p,h1,h2,h3,h4,h5,h6,a,strong,em,s,mark,span,label");
    const pair = before.ownerDocument.createElement(phrasing ? "span" : "div");
    pair.className = "inline-diff-proposal"; pair.setAttribute("role","group"); pair.setAttribute("aria-label",`Proposed ${placement.unit.proposal.kind}`); ownReviewElement(pair,placement.unit.id);
    const sides: HTMLElement[] = [];
    for (const [side, content, start] of [["before",fragment.before,fragment.oldStart],["after",fragment.after,fragment.newStart]] as const) {
      const panel = before.ownerDocument.createElement(phrasing ? "span" : "div"); panel.className = `inline-diff-side inline-diff-${side}`; panel.dataset.inlineDiffSide = side; panel.setAttribute("role","group"); panel.setAttribute("aria-label",side === "before" ? "Before" : "After");
      const body = before.ownerDocument.createElement(phrasing ? "span" : "div"); body.className = "inline-diff-side-content";
      sideShell(body,content,start); panel.append(body); pair.append(panel); sides.push(body);
    }
    if (proxy) { (proxy.querySelector("td") ?? proxy).append(pair); fragment.marker.replaceWith(proxy); }
    else fragment.marker.replaceWith(pair);
    placement.before.selectNodeContents(sides[0]); placement.after.selectNodeContents(sides[1]);
    placement.anchor = pair; paired.set(pair,{before:sides[0],after:sides[1],unit:placement.unit});
  }
  settleCommentTrivia(before, trivia);
  return { element: before, placements };
}
export function comparisonSides(pair: HTMLElement): { before: HTMLElement; after: HTMLElement; unit: ReviewUnit } | undefined { return paired.get(pair); }
export function registerReviewAnchors(root: HTMLElement, units: ReviewUnit[], editable: boolean): Map<string, HTMLElement[]> {
  const anchors = new Map<string, HTMLElement[]>();
  for (const unit of units) {
    const pair = [...root.querySelectorAll<HTMLElement>(".inline-diff-proposal")].find(element => reviewIdentity(element) === unit.id);
    const elements = pair ? [pair] : []; anchors.set(unit.id,elements);
    if (pair) { pair.classList.add("inline-diff-hunk-anchor"); pair.dataset.inlineDiffHunk = `${unit.id}:comparison`; if (editable) pair.tabIndex = 0; }
  }
  registries.set(root,anchors); return anchors;
}
export function reviewAnchors(host: HTMLElement, proposalId: string): HTMLElement[] { return [...host.querySelectorAll<HTMLElement>(".inline-diff-review")].flatMap(root => registries.get(root)?.get(proposalId) ?? []).filter(element => element.isConnected); }
export function unregisterReviewAnchors(root: HTMLElement): void { registries.delete(root); }
