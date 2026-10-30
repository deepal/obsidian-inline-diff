import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, project, reviewGroups, resolveProposal } from "../src/model.ts";
import { markdownFixtures, literalFixtures, boundaryFixtures } from "./fixtures/markdown.mjs";

for (const fixture of markdownFixtures) test(fixture.id, () => {
  const note = parseNote(fixture.source);
  assert.deepEqual(note.diagnostics, [], "valid proposal diagnostics");
  assert.equal(note.proposals.length, 1, "one proposal");
  assert.equal(project(note, "reject").text, fixture.before);
  assert.equal(project(note, "accept").text, fixture.after);
  for (const decision of ["accept", "reject"]) assert.equal(resolveProposal(note.source, note.source, note.proposals[0], decision), decision === "accept" ? fixture.after : fixture.before);
  const groups = reviewGroups(note);
  assert.equal(groups.length, 1);
  assert.ok(groups[0].from <= note.proposals[0].from && groups[0].to >= note.proposals[0].to);
  assert.ok(!groups[0].before.includes("{~~") && !groups[0].after.includes("{~~"));
});

for (const [index, source] of literalFixtures.entries()) test(`literal-${index}`, () => {
  assert.equal(parseNote(source).proposals.length, 0);
  assert.equal(project(parseNote(source), "accept").text, source);
});
for (const fixture of boundaryFixtures) test(`boundary-${fixture.id}`, () => {
  const note = parseNote(fixture.source); assert.deepEqual(note.diagnostics, []);
  assert.equal(project(note, "reject").text, fixture.before);
  assert.equal(project(note, "accept").text, fixture.after);
});

test("frontmatter, BOM, CRLF and final-newline preservation", () => {
  for (const eol of ["\n", "\r\n"]) for (const final of ["", eol]) {
    const head = `\uFEFF---${eol}literal: '{++not a change++}'${eol}---${eol}`;
    const source = `${head}{~~${eol}old${eol}~>${eol}new${eol}~~}${final}`;
    const note = parseNote(source);
    assert.equal(note.proposals.length, 1);
    assert.equal(project(note, "reject").text, `${head}old${final}`);
    assert.equal(project(note, "accept").text, `${head}new${final}`);
  }
  assert.equal(parseNote("---\n{++body after horizontal rule++}").proposals.length, 1);
});

test("nested, mismatched, incomplete and malformed proposals are non-actionable", () => {
  for (const source of ["{++outer {--inner--}++}", "{~~old~>new++}", "{++unfinished", "{~~missing separator~~}", "{~~one~>two~>three~~}"]) {
    const note = parseNote(source);
    assert.equal(note.proposals.length, 0, source);
    assert.ok(note.diagnostics.length, source);
    assert.equal(project(note, "accept").text, source);
  }
});

test("source identity prevents stale edits and duplicate-text substitution", () => {
  const source = "{~~same~>first~~} and {~~same~>second~~}";
  const note = parseNote(source);
  assert.equal(resolveProposal(source, source, note.proposals[1], "accept"), "{~~same~>first~~} and second");
  assert.equal(resolveProposal(`changed ${source}`, source, note.proposals[1], "accept"), null);
  assert.equal(resolveProposal(source.replace("second", "new"), source, note.proposals[1], "reject"), null);
});

test("projection mappings retain exact source identity across UTF-16 offsets and empty arms", () => {
  const note = parseNote("α {~~old~>new~~} ω");
  for (const decision of ["accept", "reject"]) assert.deepEqual(project(note, decision).mappings, [
    { from: 0, to: 2, sourceFrom: 0, sourceTo: 2, proposalId: undefined },
    { from: 2, to: 5, sourceFrom: 2, sourceTo: 16, proposalId: "2:16" },
    { from: 5, to: 7, sourceFrom: 16, sourceTo: 18, proposalId: undefined },
  ]);
  const addition = parseNote("🙂{++x++}Z");
  assert.deepEqual(project(addition, "reject").mappings, [
    { from: 0, to: 2, sourceFrom: 0, sourceTo: 2, proposalId: undefined },
    { from: 2, to: 2, sourceFrom: 2, sourceTo: 9, proposalId: "2:9" },
    { from: 2, to: 3, sourceFrom: 9, sourceTo: 10, proposalId: undefined },
  ]);
});

test("literal markers in indented-code proposal arms do not become nested proposals", () => {
  for (const eol of ["\n", "\r\n"]) {
    const source = `{~~${eol}    {++old literal++}${eol}~>${eol}    {--new literal--}${eol}~~}${eol}`;
    const note = parseNote(source);
    assert.equal(note.proposals.length, 1); assert.deepEqual(note.diagnostics, []);
    assert.equal(project(note, "reject").text, `    {++old literal++}${eol}`);
    assert.equal(project(note, "accept").text, `    {--new literal--}${eol}`);
  }
});

test("block separators and closers occupy complete lines, preserving literal URL punctuation", () => {
  const source = "{~~\n[old](https://example.test/a~>b++})\n~>\n[new](https://example.test/c~>d--})\n~~}\n";
  const note = parseNote(source);
  assert.equal(note.proposals.length, 1); assert.deepEqual(note.diagnostics, []);
  assert.equal(project(note, "reject").text, "[old](https://example.test/a~>b++})\n");
  assert.equal(project(note, "accept").text, "[new](https://example.test/c~>d--})\n");
  assert.equal(project(parseNote("{++A ~> B++}"), "accept").text, "A ~> B");
  const empty = parseNote("{++\n++}");
  assert.equal(empty.proposals.length, 1); assert.equal(project(empty, "accept").text, "");
  assert.ok(empty.proposals[0].afterRange.from <= empty.proposals[0].afterRange.to);
});

test("shared container grouping retains independent proposals", () => {
  for (const source of ["A {~~one~>two~~} and {++three++}.", "| A | B |\n|---|---|\n|{~~one~>two~~}|{++three++}|", "> [!note]\n> {--one--}\n> {++two++}"]) {
    const note = parseNote(source);
    const groups = reviewGroups(note);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].proposals.length, 2);
    const accepted = resolveProposal(source, source, note.proposals[0], "accept");
    assert.equal(parseNote(accepted).proposals.length, 1);
  }
  assert.equal(reviewGroups(parseNote("First {++one++}.\n\nSecond {++two++}.")).length, 2);
});

test("delimiter escapes remain literal after resolution without creating phantom proposals", () => {
  const source = "Outside \\{++literal++}. {++inside \\{++literal\\++} and A\\|B++}";
  const note = parseNote(source);
  assert.equal(note.proposals.length, 1);
  assert.equal(project(note, "accept").text, "Outside \\{++literal++}. inside \\{++literal\\++} and A\\|B");
  assert.equal(parseNote(project(note, "accept").text).proposals.length, 0);
});

test("10,000 deterministic transformations preserve unrelated text and mixed resolutions", () => {
  let seed = 0x194af32;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const words = ["alpha", "🙂", "é", "שלום", "漢字", "**bold**", "A\\|B", "two  spaces", "_italic_", "[link](Target)"];
  for (let run = 0; run < 10000; run++) {
    const old = words[next() % words.length], fresh = words[next() % words.length];
    const prefix = `${words[next() % words.length]} unchanged `, suffix = ` end ${run}`;
    const source = `${prefix}{~~${old}~>${fresh}~~}${suffix}`;
    const note = parseNote(source);
    assert.equal(note.proposals.length, 1);
    assert.equal(project(note, "reject").text, prefix + old + suffix);
    assert.equal(project(note, "accept").text, prefix + fresh + suffix);
    const changed = resolveProposal(source, source, note.proposals[0], run % 2 ? "accept" : "reject");
    assert.equal(changed, prefix + (run % 2 ? fresh : old) + suffix);
  }
});
