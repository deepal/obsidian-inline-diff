import { Component, MarkdownRenderer, type App, type MarkdownView } from "obsidian";
import { diffWordsWithSpace } from "diff";
import { project, type ParsedNote, type Proposal, type ReviewGroup } from "./model";
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

function textNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}

function markRange(root: HTMLElement, from: number, to: number, side: "before" | "after"): void {
  let position = 0;
  for (const node of textNodes(root)) {
    const end = position + node.length;
    if (position < to && end > from) {
      const range = root.ownerDocument.createRange();
      range.setStart(node, Math.max(0, from - position));
      range.setEnd(node, Math.min(node.length, to - position));
      // The selection and mark must share a document.
      const mark = root.ownerDocument.createElement("span");
      mark.className = `inline-diff-changed inline-diff-${side === "before" ? "deletion" : "addition"}`;
      range.surroundContents(mark);
    }
    position = end;
  }
}

function highlight(before: HTMLElement, after: HTMLElement, proposals: Proposal[]): Set<string> {
  const visible = new Set<string>();
  const oldText = before.textContent ?? "";
  const newText = after.textContent ?? "";
  type Highlight = { from: number; to: number; proposal: Proposal | undefined };
  const oldRanges: Highlight[] = [], newRanges: Highlight[] = [];
  let oldPosition = 0, newPosition = 0;
  for (const part of diffWordsWithSpace(oldText, newText)) {
    if (part.removed || part.added) {
      const candidates = proposals.filter(proposal => (part.removed ? proposal.before : proposal.after).includes(part.value.trim()));
      // Never guess an action target for indistinguishable visual hunks.
      // Numbered source anchors retain exact identity for those proposals.
      const proposal = proposals.length === 1 ? proposals[0] : candidates.length === 1 ? candidates[0] : undefined;
      for (const candidate of proposal ? [proposal] : candidates) visible.add(candidate.id);
      if (part.removed) oldRanges.push({ from: oldPosition, to: oldPosition + part.value.length, proposal });
      else newRanges.push({ from: newPosition, to: newPosition + part.value.length, proposal });
    }
    if (!part.added) oldPosition += part.value.length;
    if (!part.removed) newPosition += part.value.length;
  }
  const apply = (root: HTMLElement, text: string, ranges: Highlight[], side: "before" | "after") => {
    const clusters = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    const merged: Highlight[] = [];
    for (const range of ranges) {
      const start = clusters.containing(range.from);
      const end = clusters.containing(range.to - 1);
      const expanded = { ...range, from: start?.index ?? range.from, to: end ? end.index + end.segment.length : range.to };
      const previous = merged[merged.length - 1];
      if (previous && expanded.from < previous.to) {
        previous.to = Math.max(previous.to, expanded.to);
        if (previous.proposal?.id !== expanded.proposal?.id) previous.proposal = undefined;
      } else merged.push(expanded);
    }
    for (const range of merged) markRange(root, range.from, range.to, side);
  };
  apply(before, oldText, oldRanges, "before"); apply(after, newText, newRanges, "after");
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
    // Use the owning document, including popouts.
    const root = doc.createElement("section");
    this.element = root; root.className = "inline-diff-review";
    root.dataset.inlineDiffGroup = group.id;
    applyColours(root, settings);
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Proposed changes");
    const file = view?.file ?? null;
    for (const diagnostic of note.diagnostics.filter(diagnostic => diagnostic.from < group.to && diagnostic.to > group.from)) {
      root.createDiv({ cls: "inline-diff-error inline-diff-diagnostic-banner", text: diagnostic.message });
    }
    if (view) {
      // A single change needs no numbered heading. The comparison itself is
      // the keyboard anchor; shared containers have floating identity anchors.
      const anchors = group.proposals.length > 1 ? root.createDiv({ cls: "inline-diff-anchors" }) : null;
      for (const [index, proposal] of group.proposals.entries()) {
        const anchor = anchors ? anchors.createSpan({ cls: "inline-diff-proposal-anchor", text: `${index + 1}` }) : root;
        anchor.classList.add("inline-diff-proposal-anchor");
        anchor.tabIndex = 0; anchor.dataset.inlineDiffId = proposal.id;
        anchor.setAttribute("aria-label", `Change ${index + 1}: ${proposal.kind}`);
        if (anchors) anchor.title = `${proposal.before || "(empty)"} → ${proposal.after || "(empty)"}`;
      }
      const show = (event: Event) => {
        if (!plugin.isActive) return;
        const target = event.target as HTMLElement;
        const anchor = target.closest<HTMLElement>(".inline-diff-proposal-anchor,.inline-diff-source-entry") ?? root;
        const proposal = group.proposals.find(p => p.id === anchor.dataset.inlineDiffId) ?? (group.proposals.length === 1 ? group.proposals[0] : undefined);
        // Highlights are display-only. All rendered review actions belong at
        // the comparison's top right, even when a numbered selector has focus.
        if (proposal) plugin.overlay(doc).show(root, { view, file, source: note.source, proposal }, anchor);
      };
      this.registerDomEvent(root, "pointerover", show);
      this.registerDomEvent(root, "focusin", show);
      this.registerDomEvent(root, "keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!(event.target as Element).matches(".inline-diff-proposal-anchor,.inline-diff-source-entry")) return;
        event.preventDefault(); event.stopPropagation(); show(event); plugin.overlay(doc).focus();
      });
      this.registerDomEvent(root, "pointerleave", () => plugin.scheduleOverlayHide(doc));
    }
    const before = root.createDiv({ cls: "inline-diff-side inline-diff-before" });
    before.setAttribute("role", "group"); before.setAttribute("aria-label", "Before");
    const oldBody = before.createDiv({ cls: "inline-diff-content markdown-rendered" });
    const after = root.createDiv({ cls: "inline-diff-side inline-diff-after" });
    after.setAttribute("role", "group"); after.setAttribute("aria-label", "After");
    const newBody = after.createDiv({ cls: "inline-diff-content markdown-rendered" });
    const render = async (body: HTMLElement, markdown: string, decision: "accept" | "reject") => {
      if (!markdown.trim()) { body.createSpan({ cls: "inline-diff-empty", text: "Empty" }); return; }
      if (/\[\^|\^\[/.test(markdown) || (markdown.includes("[") && documentContext(note).hasReferences)) {
        // Footnote ordinals depend on earlier references elsewhere in the note.
        // Render with the complete clean document context, then move only this
        // container's nodes (and native footnotes) into its comparison side.
        const prefixNote: ParsedNote = { ...note, source: note.source.slice(0, group.from), proposals: note.proposals.filter(proposal => proposal.to <= group.from) };
        const prefix = project(prefixNote, decision).text.slice(note.frontmatterEnd);
        const complete = (decision === "accept" ? documentContext(note).after : documentContext(note).before).slice(note.frontmatterEnd);
        const suffix = complete.slice(prefix.length + markdown.length);
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
        const ids = new Map<string, string>();
        for (const element of body.querySelectorAll<HTMLElement>(".footnotes [id], .footnote-ref[id]")) {
          const id = element.id; ids.set(id, `${marker}-${id}`); element.id = `${marker}-${id}`;
        }
        for (const link of body.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) {
          const mapped = ids.get(link.getAttribute("href")!.slice(1));
          if (mapped) link.setAttribute("href", `#${mapped}`);
        }
        return;
      }
      await MarkdownRenderer.render(app, markdown, body, sourcePath, this);
    };
    this.ready = Promise.all([render(oldBody, group.before, "reject"), render(newBody, group.after, "accept")]).then(() => {
      if (this.cancelled) return;
      makeReadOnly(oldBody, this); makeReadOnly(newBody, this);
      const visible = highlight(oldBody, newBody, group.proposals);
      const hidden = group.proposals.filter(proposal => !visible.has(proposal.id));
      // Ordinary edits need only the rendered comparison. Preserve reviewable
      // evidence when rendering hides a link destination, comment, etc.
      if (hidden.length) {
        const details = root.createEl("details", { cls: "inline-diff-source" });
        details.createEl("summary", { text: "Hidden Markdown changes" });
        for (const proposal of hidden) {
          const entry = details.createDiv({ cls: "inline-diff-source-entry" });
          entry.dataset.inlineDiffId = proposal.id;
          if (view) entry.tabIndex = 0;
          entry.createEl("pre", { cls: "inline-diff-deletion", text: proposal.before || "(empty)" });
          entry.createEl("pre", { cls: "inline-diff-addition", text: proposal.after || "(empty)" });
        }
        details.open = true;
      }
      root.dataset.inlineDiffReady = "true";
    }).catch((error: unknown) => {
      if (!this.cancelled) {
        root.createDiv({ cls: "inline-diff-error", text: "Could not render the comparison. The proposal is preserved in source." });
        console.error("Inline Diff: comparison rendering failed", error);
      }
    });
    this.register(() => { this.cancelled = true; });
  }
}
