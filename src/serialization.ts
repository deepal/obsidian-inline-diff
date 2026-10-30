import { parseNote, project, resolveProposal, type Decision, type Proposal } from "./model.ts";
import { preserveLineEndings } from "./line-endings.ts";

export const normalizedText = (text: string): string => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
export interface ReviewSerialization { before: string; after: string }

/** Resolve the same ordered source range in the byte-preserving projection.
 * No text search can substitute a duplicate proposal for the captured target. */
export function serializeReview(disk: string, source: string, decision: Decision, target?: Proposal): ReviewSerialization | null {
  const before = preserveLineEndings(disk, source);
  if (normalizedText(before) !== normalizedText(source)) return null;
  const editor = parseNote(source), raw = parseNote(before);
  if (editor.proposals.length !== raw.proposals.length) return null;
  if (!target) return { before, after: project(raw, decision).text };
  const index = editor.proposals.findIndex(proposal => proposal.from === target.from && proposal.to === target.to && proposal.raw === target.raw);
  const proposal = raw.proposals[index];
  if (!proposal || normalizedText(proposal.raw) !== normalizedText(target.raw)) return null;
  const after = resolveProposal(before, before, proposal, decision);
  return after === null ? null : { before, after };
}
