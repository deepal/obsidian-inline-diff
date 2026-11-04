import { diffWordsWithSpace } from "diff";
import { Component, MarkdownRenderer, type App, type MarkdownView } from "obsidian";
import { project, reviewUnits, type ParsedNote, type Proposal, type ReviewGroup } from "./model";
import { applyColours, type DiffSettings } from "./settings";
import type InlineDiffPlugin from "./main";

const contexts = new WeakMap<ParsedNote, { before: string; after: string; hasReferences: boolean }>();
function documentContext(note: ParsedNote) {
  let context = contexts.get(note);
  if (!context) {
    const before = project(note, "reject").text, after = project(note, "accept").text;
    context = { before, after, hasReferences: /^ {0,3}\[[^\]]+\]:/m.test(before.slice(note.frontmatterEnd)) || /^ {0,3}\[[^\]]+\]:/m.test(after.slice(note.frontmatterEnd)) };
    contexts.set(note, context);
  }
  return context;
}

import { prepareProjection, captureProjection, assembleComparisons, comparisonSides, registerReviewAnchors, unregisterReviewAnchors, reviewIdentity } from "./unified";

function textNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}

/** Renderer formatting whitespace must not become an element between blocks. */
function structuralSeparators(root: HTMLElement): Set<Text> {
  const separators = new Set<Text>();
  const win = root.ownerDocument.defaultView!;
  const block = (element: Element | null): boolean => {
    if (!element) return false;
    return /^(block|flow-root|list-item|flex|grid|table)(\s|-|$)/.test(win.getComputedStyle(element).display);
  };
  // Obsidian can render existing panes before reloading the plugin stylesheet.
  // Measure using the comparison's intended whitespace even during that gap.
  const previous = root.getAttribute("style");
  root.setCssStyles({ whiteSpace: "normal" });
  try {
    for (const node of textNodes(root)) {
      // NBSP and other Unicode spaces can be meaningful rendered content.
      if (!/^[\t\n\f\r ]+$/.test(node.data)) continue;
      let preserved = false;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent.matches("pre,code,textarea,math,mjx-container,svg") || /^(pre|pre-wrap|pre-line|break-spaces)$/.test(win.getComputedStyle(parent).whiteSpace)) { preserved = true; break; }
        if (parent === root) break;
      }
      if (!preserved && (node.parentElement?.matches("ul,ol,table,thead,tbody,tfoot,tr,colgroup") || block(node.previousElementSibling) || block(node.nextElementSibling))) separators.add(node);
    }
  } finally {
    if (previous === null) root.removeAttribute("style");
    else root.setAttribute("style", previous);
  }
  return separators;
}

function markRange(root: HTMLElement, from: number, to: number, side: "before" | "after", separators: Set<Text>): boolean {
  let position = 0;
  let marked = false;
  for (const node of textNodes(root)) {
    const end = position + node.length;
    if (!separators.has(node) && position < to && end > from) {
      const structure = node.parentElement?.closest(".math,svg");
      // MathJax/SVG glyph layout cannot contain ordinary HTML highlight spans.
      if (structure) {
        structure.classList.add(`inline-diff-${side === "before" ? "deletion" : "addition"}`);
        marked = true;
        position = end;
        continue;
      }
      const range = root.ownerDocument.createRange();
      range.setStart(node, Math.max(0, from - position));
      range.setEnd(node, Math.min(node.length, to - position));
      // The selection and mark must share a document.
      const mark = root.ownerDocument.createElement("span");
      mark.className = `inline-diff-text inline-diff-changed inline-diff-${side === "before" ? "deletion" : "addition"}`;
      range.surroundContents(mark);
      marked = true;
    }
    position = end;
  }
  return marked;
}

function highlight(before: HTMLElement, after: HTMLElement, proposals: Proposal[]): Set<string> {
  const visible = new Set<string>();
  const oldText = before.textContent ?? "";
  const newText = after.textContent ?? "";
  const oldSeparators = structuralSeparators(before), newSeparators = structuralSeparators(after);
  const withoutSeparators = (root: HTMLElement, separators: Set<Text>) => textNodes(root).filter(node => !separators.has(node)).map(node => node.data).join("");
  if (withoutSeparators(before, oldSeparators) === withoutSeparators(after, newSeparators)) return visible;
  type Highlight = { from: number; to: number; ids: string[] };
  const oldRanges: Highlight[] = [], newRanges: Highlight[] = [];
  let oldPosition = 0, newPosition = 0;
  for (const part of diffWordsWithSpace(oldText, newText)) {
    if (part.removed || part.added) {
      // This pair already owns one exact source proposal; highlights never
      // determine approval identity by searching rendered words.
      const ids = proposals.map(proposal => proposal.id);
      if (part.removed) oldRanges.push({ from: oldPosition, to: oldPosition + part.value.length, ids });
      else newRanges.push({ from: newPosition, to: newPosition + part.value.length, ids });
    }
    if (!part.added) oldPosition += part.value.length;
    if (!part.removed) newPosition += part.value.length;
  }
  const apply = (root: HTMLElement, text: string, ranges: Highlight[], side: "before" | "after", separators: Set<Text>) => {
    const clusters = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    const merged: Highlight[] = [];
    for (const range of ranges) {
      const start = clusters.containing(range.from);
      const end = clusters.containing(range.to - 1);
      const expanded = { ...range, from: start?.index ?? range.from, to: end ? end.index + end.segment.length : range.to };
      const previous = merged[merged.length - 1];
      if (previous && expanded.from < previous.to) {
        previous.to = Math.max(previous.to, expanded.to);
        previous.ids = [...new Set([...previous.ids, ...expanded.ids])];
      } else merged.push(expanded);
    }
    for (const range of merged) if (markRange(root, range.from, range.to, side, separators)) for (const id of range.ids) visible.add(id);
  };
  apply(before, oldText, oldRanges, "before", oldSeparators); apply(after, newText, newRanges, "after", newSeparators);
  return visible;
}

/** Comparison bodies never expose native writing widgets (tasks, bases, etc.). */
function makeReadOnly(root: HTMLElement, owner: Component): void {
  const disable = () => {
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,textarea,select,button,[contenteditable]")) {
    if ("disabled" in input) input.disabled = true;
    input.removeAttribute("contenteditable");
  }
  // Generated interactive views are inert, while ordinary links and callout
  // folding retain native display/navigation behaviour.
  for (const element of root.querySelectorAll<HTMLElement>(".bases-embed, .bases-view, .block-language-base, iframe")) element.inert = true;
  };
  disable();
  const observer = new root.ownerDocument.defaultView!.MutationObserver(disable);
  observer.observe(root, { childList: true, subtree: true });
  owner.register(() => observer.disconnect());
  owner.registerDomEvent(root, "click", event => {
    const element = (event.target as Element | null)?.closest?.("input,button,[contenteditable],.bases-embed,.bases-view,.block-language-base");
    if (element) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}

export class Comparison extends Component {
  readonly element: HTMLElement;
  readonly ready: Promise<void>;
  private cancelled = false;

  constructor(
    app: App, doc: Document, private plugin: InlineDiffPlugin,
    note: ParsedNote, readonly group: ReviewGroup, sourcePath: string,
    view: MarkdownView | null, settings: DiffSettings,
  ) {
    super();
    const root = doc.createElement("section");
    this.element = root; root.className = "inline-diff-review";
    root.dataset.inlineDiffGroup = group.id;
    applyColours(root, settings);
    root.setAttribute("role", "group"); root.setAttribute("aria-label", "Proposed changes");
    for (const diagnostic of note.diagnostics.filter(diagnostic => diagnostic.from < group.to && diagnostic.to > group.from)) root.createDiv({ cls: "inline-diff-error inline-diff-diagnostic-banner", text: diagnostic.message });
    const file = view?.file ?? null, units = reviewUnits(note, group), referenceNamespace = crypto.randomUUID();
    const body = () => { const element = doc.createElement("div"); element.className = "inline-diff-content markdown-rendered"; return element; };
    const oldBody = body(), newBody = body();
    if (view) {
      const show = (event: Event) => {
        if (!plugin.isActive) return;
        const anchor = (event.target as Element).closest<HTMLElement>(".inline-diff-unit");
        const proposal = group.proposals.find(p => p.id === (anchor ? reviewIdentity(anchor) : undefined));
        if (anchor && proposal) plugin.overlay(doc).show(anchor, { view, file, source: note.source, proposal }, anchor);
      };
      this.registerDomEvent(root, "pointerover", show);
      this.registerDomEvent(root, "focusin", show);
      this.registerDomEvent(root, "keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!(event.target as Element).matches(".inline-diff-hunk-anchor") || (event.target as Element).matches("a,button,input")) return;
        event.preventDefault(); event.stopPropagation(); show(event); plugin.overlay(doc).focus();
      });
      this.registerDomEvent(root, "pointerleave", () => plugin.scheduleOverlayHide(doc));
    }
    const render = async (body: HTMLElement, markdown: string, decision: "accept" | "reject") => {
      if (!markdown.trim()) return;
      if (/\[\^|\^\[/.test(markdown) || (markdown.includes("[") && documentContext(note).hasReferences)) {
        // Footnote ordinals depend on earlier references elsewhere in the note.
        // Render with the complete clean document context, then move only this
        // container's nodes (and native footnotes) into its comparison side.
        const prefixNote: ParsedNote = { ...note, source: note.source.slice(0, group.from), proposals: note.proposals.filter(proposal => proposal.to <= group.from) };
        const prefix = project(prefixNote, decision).text.slice(note.frontmatterEnd);
        const complete = (decision === "accept" ? documentContext(note).after : documentContext(note).before).slice(note.frontmatterEnd);
        const suffix = complete.slice(prefix.length + (decision === "accept" ? group.after.length : group.before.length));
        const marker = crypto.randomUUID();
        const scratch = body.createDiv({ cls: "inline-diff-render-context" });
        await MarkdownRenderer.render(app, `${prefix}\n\n<div data-inline-diff-boundary="${marker}-start"></div>\n\n${markdown}\n\n<div data-inline-diff-boundary="${marker}-end"></div>\n\n${suffix}`, scratch, sourcePath, this);
        const start = scratch.querySelector(`[data-inline-diff-boundary="${marker}-start"]`);
        const end = scratch.querySelector(`[data-inline-diff-boundary="${marker}-end"]`);
        if (!start || !end) throw new Error("Could not isolate the comparison in its document context.");
        const range = doc.createRange(); range.setStartAfter(start); range.setEndBefore(end);
        body.append(range.extractContents());
        const footnotes = scratch.querySelector<HTMLElement>(".footnotes");
        if (footnotes && (body.querySelector(".footnote-ref") || /^\s*\[\^[^\]]+\]:/m.test(markdown))) body.append(footnotes);
        scratch.remove();
        // Before/After and separate panes must not share footnote DOM identities.
        const stableId = (id: string) => `${referenceNamespace}-${id.replace(/^((?:fn|fnref)-\d+(?:-\d+)?)-[a-f0-9]{8,}(.*)$/, "$1$2")}`;
        const ids = new Map<string, string>();
        for (const element of body.querySelectorAll<HTMLElement>(".footnotes [id], .footnote-ref[id]")) {
          const id = element.id; ids.set(id, stableId(id)); element.id = stableId(id);
        }
        for (const element of body.querySelectorAll<HTMLElement>("[data-footnote-id]")) element.dataset.footnoteId = stableId(element.dataset.footnoteId!);
        for (const link of body.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) {
          const raw = link.getAttribute("href")!.slice(1), mapped = ids.get(raw) ?? (/^fn(?:ref)?-/.test(raw) ? stableId(raw) : undefined);
          if (mapped) link.setAttribute("href", `#${mapped}`);
        }
        return;
      }
      await MarkdownRenderer.render(app, markdown, body, sourcePath, this);
    };
    this.ready = (async () => {
      await Promise.all([render(oldBody, group.before, "reject"), render(newBody, group.after, "accept")]);
      if (this.cancelled) return;
      const prefix = "ID" + crypto.randomUUID().replaceAll("-", "");
      const capture = async (original: HTMLElement, source: string, decision: "accept" | "reject") => {
        const mapping = prepareProjection(original, source, units, decision, prefix);
        if (mapping.text === source) return mapping.blocks;
        const marked = body(); await render(marked, mapping.text, decision);
        if (this.cancelled) return new Map<string, Range>();
        return captureProjection(original, marked, mapping);
      };
      const [oldRanges, newRanges] = await Promise.all([capture(oldBody, group.before, "reject"), capture(newBody, group.after, "accept")]);
      if (this.cancelled) return;
      const comparisons = assembleComparisons(oldBody, newBody, units, oldRanges, newRanges);
      // A side that contains native definitions owns its own DOM identities.
      // References to definitions outside a proposal retain the shared context.
      for (const placement of comparisons.placements) {
        const sides = placement.anchor && comparisonSides(placement.anchor);
        if (!sides) continue;
        for (const [name, side] of [["before",sides.before],["after",sides.after]] as const) {
          const ids = new Map<string,string>();
          for (const element of side.querySelectorAll<HTMLElement>("[id]")) { const id = element.id; ids.set(id,`${id}-${placement.unit.id}-${name}`); element.id = ids.get(id)!; }
          for (const element of side.querySelectorAll<HTMLElement>("[data-footnote-id]")) element.dataset.footnoteId = ids.get(element.dataset.footnoteId!) ?? element.dataset.footnoteId;
          for (const link of side.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) { const id = ids.get(link.getAttribute("href")!.slice(1)); if (id) link.setAttribute("href",`#${id}`); }
        }
      }
      root.append(comparisons.element);
      const decorate = () => {
        for (const placement of comparisons.placements) {
          const sides = placement.anchor && comparisonSides(placement.anchor);
          if (!sides) continue;
          for (const side of [sides.before, sides.after]) {
            for (const mark of side.querySelectorAll(".inline-diff-text")) mark.replaceWith(...mark.childNodes);
            side.querySelectorAll(".inline-diff-evidence,.inline-diff-empty").forEach(element => element.remove());
            side.normalize();
          }
          const visible = highlight(sides.before, sides.after, [sides.unit.proposal]);
          const attributes = (side: HTMLElement) => [...side.querySelectorAll("a,img,iframe,input")].map(element => [element.tagName, ...["href","data-href","src","alt","checked"].map(name => element.getAttribute(name))]);
          const evidence = !visible.size || JSON.stringify(attributes(sides.before)) !== JSON.stringify(attributes(sides.after));
          for (const [name, side, source] of [["before",sides.before,sides.unit.proposal.before],["after",sides.after,sides.unit.proposal.after]] as const) {
            if (!source.trim()) side.createSpan({ cls: "inline-diff-empty", text: "Empty" });
            else if (evidence) {
              const entry = side.createSpan({ cls: "inline-diff-evidence" });
              entry.createSpan({ cls: "inline-diff-evidence-label", text: "Markdown: " });
              entry.createEl("code", { cls: name === "before" ? "inline-diff-deletion" : "inline-diff-addition", text: source });
            }
          }
        }
      };
      decorate();
      for (const callout of comparisons.element.querySelectorAll<HTMLElement>(".callout.is-collapsed")) {
        callout.classList.remove("is-collapsed");
        const content = callout.querySelector<HTMLElement>(":scope > .callout-content");
        if (content) { content.style.removeProperty("display"); content.style.removeProperty("height"); }
      }
      makeReadOnly(comparisons.element, this);
      registerReviewAnchors(root, units, !!view);
      const observer = new doc.defaultView!.MutationObserver(() => {
        if (this.cancelled) return;
        observer.disconnect(); decorate(); observer.observe(comparisons.element, { childList: true, subtree: true });
      });
      observer.observe(comparisons.element, { childList: true, subtree: true });
      this.register(() => observer.disconnect());
      root.dataset.inlineDiffReady = "true";
    })().catch((error: unknown) => {
      if (!this.cancelled) {
        root.createDiv({ cls: "inline-diff-error", text: "Could not render the comparison. The proposal is preserved in source." });
        console.error("Inline Diff: comparison rendering failed", error);
      }
    });
    this.register(() => { this.cancelled = true; unregisterReviewAnchors(root); });
  }
}
