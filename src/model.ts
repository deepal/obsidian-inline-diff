import MarkdownIt from "markdown-it";

export type Decision = "accept" | "reject";
export interface Span { from: number; to: number }
export interface Proposal extends Span {
  id: string;
  kind: "addition" | "deletion" | "replacement";
  raw: string;
  before: string;
  after: string;
  beforeRange: Span;
  afterRange: Span;
}
export interface Diagnostic extends Span { message: string }
export interface ParsedNote { source: string; frontmatterEnd: number; proposals: Proposal[]; diagnostics: Diagnostic[] }
export interface Mapping extends Span { sourceFrom: number; sourceTo: number; proposalId?: string }
export interface Projection { text: string; mappings: Mapping[] }
export interface ReviewGroup extends Span { id: string; proposals: Proposal[]; before: string; after: string }

const markdown = new MarkdownIt({ html: true });
const opens = ["{++", "{--", "{~~"];
const closes = ["++}", "--}", "~~}"];

export function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  return offsets;
}

function escaped(text: string, offset: number): boolean {
  let slashes = 0;
  while (offset > 0 && text[--offset] === "\\") slashes++;
  return slashes % 2 === 1;
}

function lineStart(text: string, offset: number): boolean {
  return offset === 0 || text[offset - 1] === "\n" || (offset === 1 && text[0] === "\uFEFF");
}

function markerLine(text: string, offset: number, length: number): boolean {
  return lineStart(text, offset) && /^(?:\r?\n|$)/.test(text.slice(offset + length));
}

export function frontmatterEnd(text: string): number {
  const start = /^(?:\uFEFF)?---\r?\n/.exec(text);
  if (!start) return 0;
  const closing = /^---(?:\r?\n|$)/gm;
  closing.lastIndex = start[0].length;
  const end = closing.exec(text);
  return end ? end.index + end[0].length : 0;
}

function blockLiterals(text: string, start: number): Span[] {
  const offsets = lineOffsets(text.slice(start));
  const spans: Span[] = [];
  for (const token of markdown.parse(text.slice(start), {})) {
    if (token.map && ["fence", "code_block"].includes(token.type)) {
      spans.push({ from: start + (offsets[token.map[0]] ?? 0), to: start + (offsets[token.map[1]] ?? text.length - start) });
    }
  }
  return spans.sort((a, b) => a.from - b.from);
}

/** Literal constructs are skipped both outside proposals and within their arms. */
function literalEnd(text: string, at: number): number {
  if (escaped(text, at)) return at;
  if (text.startsWith("<!--", at)) {
    const end = text.indexOf("-->", at + 4);
    return end < 0 ? text.length : end + 3;
  }
  if (text.startsWith("%%", at)) {
    const end = text.indexOf("%%", at + 2);
    return end < 0 ? text.length : end + 2;
  }
  if (text[at] === "`") {
    const length = /^`+/.exec(text.slice(at))?.[0].length ?? 1;
    let end = at + length;
    while ((end = text.indexOf("`".repeat(length), end)) >= 0) {
      if (text[end - 1] !== "`" && text[end + length] !== "`") return end + length;
      end += length;
    }
  }
  if (text[at] === "$") {
    const length = text[at + 1] === "$" ? 2 : 1;
    if (length === 1 && (!text[at + 1] || /\s/.test(text[at + 1]))) return at;
    let end = at + length;
    while ((end = text.indexOf("$".repeat(length), end)) >= 0) {
      const inlineBoundary = length === 2 || (!/\s/.test(text[end - 1]) && !/\d/.test(text[end + 1] ?? "") && text[end + 1] !== "$");
      if (!escaped(text, end) && inlineBoundary) return end + length;
      end += length;
    }
  }
  if (text[at] === "<") {
    const tag = /^<([a-z][\w-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(text.slice(at));
    if (tag) {
      if (/\/\s*>$/.test(tag[0]) || /^(?:br|hr|img|input|source|wbr|meta|link)$/i.test(tag[1])) return at + tag[0].length;
      const tags = new RegExp(`</?${tag[1]}\\b(?:[^"'<>]|"[^"]*"|'[^']*')*>`, "ig");
      tags.lastIndex = at + tag[0].length;
      let depth = 1;
      let match: RegExpExecArray | null;
      while ((match = tags.exec(text))) {
        if (match[0].startsWith("</")) depth--;
        else if (!/\/\s*>$/.test(match[0])) depth++;
        if (!depth) return match.index + match[0].length;
      }
      return at + tag[0].length;
    }
  }
  return at;
}

function indentedArmEnd(text: string, at: number): number {
  let end = at;
  while (end < text.length) {
    const lineEnd = text.indexOf("\n", end);
    const to = lineEnd < 0 ? text.length : lineEnd + 1;
    const line = text.slice(end, to);
    if (!/^(?: {4}|\t)/.test(line) && line.trim()) break;
    end = to;
  }
  return end;
}

function arm(text: string, from: number, to: number, block: boolean, finalNewline: boolean): { value: string; range: Span } {
  if (block && !finalNewline && to > from) {
    if (text.slice(to - 2, to) === "\r\n") to -= 2;
    else if (text[to - 1] === "\n") to--;
  }
  return { value: text.slice(from, to), range: { from, to } };
}

export function parseNote(source: string): ParsedNote {
  const result: ParsedNote = { source, frontmatterEnd: frontmatterEnd(source), proposals: [], diagnostics: [] };
  const literals = blockLiterals(source, result.frontmatterEnd);
  let literalIndex = 0;
  const skip = (at: number): number => {
    while (literalIndex < literals.length && literals[literalIndex].to <= at) literalIndex++;
    const range = literals[literalIndex];
    if (range && range.from <= at) return range.to;
    return literalEnd(source, at);
  };
  for (let i = result.frontmatterEnd; i < source.length;) {
    const endLiteral = skip(i);
    if (endLiteral > i) { i = endLiteral; continue; }
    const kind = opens.indexOf(source.slice(i, i + 3));
    if (kind < 0 || escaped(source, i)) { i++; continue; }
    const from = i;
    let separator = -1;
    let close = -1;
    let invalid = "";
    const stack = [kind];
    const openingBreak = /^(?:\r\n|\n)/.exec(source.slice(from + 3));
    const blockCandidate = !!openingBreak && lineStart(source, from);
    let armStart = openingBreak ? from + 3 + openingBreak[0].length : -1;
    for (i += 3; i < source.length;) {
      // A marker line is a paragraph in the raw document, but is absent from
      // the projected arm. Recognize indented code at that new block boundary.
      if (i === armStart && /^(?: {4}|\t)/.test(source.slice(i))) { i = indentedArmEnd(source, i); continue; }
      const literal = skip(i);
      if (literal > i) { i = literal; continue; }
      if (escaped(source, i)) { i++; continue; }
      const openKind = opens.indexOf(source.slice(i, i + 3));
      const closeKind = closes.indexOf(source.slice(i, i + 3));
      if (openKind >= 0) { stack.push(openKind); invalid = "Nested proposals are not supported."; i += 3; continue; }
      if (closeKind >= 0) {
        if (blockCandidate && stack.length === 1 && !markerLine(source, i, 3)) { i += 3; continue; }
        const expected = stack.pop();
        if (closeKind !== expected) invalid = "Mismatched proposal delimiter.";
        if (!stack.length) { close = i; i += 3; break; }
        i += 3; continue;
      }
      if (source.startsWith("~>", i) && stack.length === 1 && kind === 2) {
        if (blockCandidate && !markerLine(source, i, 2)) { i += 2; continue; }
        if (separator >= 0) invalid = "Unexpected replacement separator.";
        separator = i; i += 2;
        const separatorBreak = /^(?:\r\n|\n)/.exec(source.slice(i));
        armStart = separatorBreak ? i + separatorBreak[0].length : -1;
        continue;
      }
      i++;
    }
    if (close < 0) invalid = "Unclosed proposal.";
    if (kind === 2 && separator < 0) invalid ||= "Replacement requires a separator.";
    if (invalid) { result.diagnostics.push({ from, to: i, message: invalid }); continue; }
    const openBreak = /^(?:\r\n|\n)/.exec(source.slice(from + 3));
    const block = !!openBreak && lineStart(source, from) && source[close - 1] === "\n";
    if (block && separator >= 0 && (source[separator - 1] !== "\n" || !/^(?:\r\n|\n)/.test(source.slice(separator + 2)))) {
      result.diagnostics.push({ from, to: i, message: "Block replacement separator must occupy its own line." }); continue;
    }
    let contentFrom = from + 3;
    let afterFrom = separator >= 0 ? separator + 2 : contentFrom;
    if (block) {
      contentFrom += openBreak[0].length;
      afterFrom = separator >= 0 ? separator + 2 + (/^\r?\n/.exec(source.slice(separator + 2))?.[0].length ?? 0) : contentFrom;
    }
    const finalBreak = block ? /^\r?\n/.exec(source.slice(i))?.[0] : undefined;
    if (finalBreak) i += finalBreak.length;
    const old = arm(source, contentFrom, separator >= 0 ? separator : close, block, !!finalBreak);
    const next = arm(source, afterFrom, close, block, !!finalBreak);
    const before = kind === 0 ? "" : old.value;
    const after = kind === 1 ? "" : next.value;
    result.proposals.push({
      id: `${from}:${i}`, from, to: i, raw: source.slice(from, i),
      kind: (["addition", "deletion", "replacement"] as const)[kind],
      before, after, beforeRange: old.range, afterRange: next.range,
    });
  }
  return result;
}

export function project(note: ParsedNote, decision: Decision): Projection {
  let text = "";
  const mappings: Mapping[] = [];
  let position = 0;
  const append = (value: string, sourceFrom: number, sourceTo: number, proposalId?: string) => {
    mappings.push({ from: text.length, to: text.length + value.length, sourceFrom, sourceTo, proposalId });
    text += value;
  };
  for (const proposal of note.proposals) {
    append(note.source.slice(position, proposal.from), position, proposal.from);
    append(decision === "accept" ? proposal.after : proposal.before, proposal.from, proposal.to, proposal.id);
    position = proposal.to;
  }
  append(note.source.slice(position), position, note.source.length);
  return { text, mappings };
}

function sourceOffset(projection: Projection, at: number, end: boolean): number {
  const candidates = projection.mappings.filter(mapping => mapping.from <= at && mapping.to >= at);
  const mapping = end ? candidates[0] : candidates[candidates.length - 1];
  if (!mapping) return 0;
  if (mapping.proposalId) return end ? mapping.sourceTo : mapping.sourceFrom;
  return mapping.sourceFrom + at - mapping.from;
}

function containers(projection: Projection, frontmatter: number): Span[] {
  const offsets = lineOffsets(projection.text.slice(frontmatter));
  const ranges: Span[] = [];
  for (const token of markdown.parse(projection.text.slice(frontmatter), {})) {
    if (token.level === 0 && token.map) {
      const from = frontmatter + (offsets[token.map[0]] ?? 0);
      const to = frontmatter + (offsets[token.map[1]] ?? projection.text.length - frontmatter);
      ranges.push({ from: sourceOffset(projection, from, false), to: sourceOffset(projection, to, true) });
    }
  }
  return ranges;
}

export function reviewGroups(note: ParsedNote): ReviewGroup[] {
  if (!note.proposals.length) return [];
  const ranges = [...containers(project(note, "reject"), note.frontmatterEnd), ...containers(project(note, "accept"), note.frontmatterEnd)];
  const groups: ReviewGroup[] = [];
  for (const proposal of note.proposals) {
    let from = proposal.from;
    let to = proposal.to;
    for (const range of ranges) if (range.from < to && range.to > from) { from = Math.min(from, range.from); to = Math.max(to, range.to); }
    const previous = groups[groups.length - 1];
    if (previous && previous.to > from) { previous.to = Math.max(previous.to, to); previous.proposals.push(proposal); }
    else groups.push({ id: proposal.id, from, to, proposals: [proposal], before: "", after: "" });
  }
  for (const group of groups) {
    const slice: ParsedNote = { source: note.source.slice(group.from, group.to), frontmatterEnd: 0, diagnostics: [], proposals: group.proposals.map(p => ({ ...p, from: p.from - group.from, to: p.to - group.from })) };
    group.before = project(slice, "reject").text;
    group.after = project(slice, "accept").text;
  }
  return groups;
}

/** Exact identity check; deliberately never searches for matching text elsewhere. */
export function resolveProposal(source: string, expectedSource: string, proposal: Proposal, decision: Decision): string | null {
  if (source !== expectedSource || source.slice(proposal.from, proposal.to) !== proposal.raw) return null;
  const current = parseNote(source).proposals.find(p => p.from === proposal.from && p.to === proposal.to && p.raw === proposal.raw);
  if (!current) return null;
  return source.slice(0, current.from) + (decision === "accept" ? current.after : current.before) + source.slice(current.to);
}
