/**
 * Tests for parsePgn structured comments (issue #191 — PRD-0004 Slice 4)
 *
 * TDD vertical slices:
 *  1. Legacy plain-text comment → wraps into RichTextDoc note, shapes=[], purpose=null
 *  2. Structured [gambitly:v1] comment → deserialises note/shapes/purpose
 *  3. node.annotation shim still works
 *  4. hasShapes + mistakeNodes aggregates
 *  5. serializePgn round-trip
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parsePgn, MAX_PGN_CHARS, type PgnNode, type RichTextDoc, type Shape } from "../parsePgn";
import { serializePgn } from "../serializePgn";

const FIXTURES_DIR = join(__dirname, "../__fixtures__/pgn");
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

// ── Slice 1: Legacy plain-text comment wraps to RichTextDoc ──────────────────

describe("parsePgn — structured comments (issue #191)", () => {
  describe("legacy plain-text comment", () => {
    it("wraps legacy annotation into a single-paragraph RichTextDoc on node.note", () => {
      const r = parsePgn("1. e4 {A good move} e5");
      expect(r.valid).toBe(true);
      const e4 = r.mainLine[0];
      expect(e4.note).not.toBeNull();
      expect(e4.note!.type).toBe("doc");
      expect(e4.note!.content[0].type).toBe("paragraph");
      expect(e4.note!.content[0].content![0].text).toBe("A good move");
    });

    it("node.annotation shim returns the plain text from note", () => {
      const r = parsePgn("1. e4 {A good move} e5");
      const e4 = r.mainLine[0];
      expect(e4.annotation).toBe("A good move");
    });

    it("node with no comment has note=null and annotation=undefined", () => {
      const r = parsePgn("1. e4 e5");
      const e4 = r.mainLine[0];
      expect(e4.note).toBeNull();
      expect(e4.annotation).toBeUndefined();
    });

    it("node with no comment has shapes=[] and purpose=null", () => {
      const r = parsePgn("1. e4 e5");
      const e4 = r.mainLine[0];
      expect(e4.shapes).toEqual([]);
      expect(e4.purpose).toBeNull();
    });

    it("node with legacy comment has shapes=[] and purpose=null", () => {
      const r = parsePgn("1. e4 {A good move} e5");
      const e4 = r.mainLine[0];
      expect(e4.shapes).toEqual([]);
      expect(e4.purpose).toBeNull();
    });
  });

  // ── Slice 2: Structured [gambitly:v1] comment ────────────────────────────────

  describe("structured [gambitly:v1] comment", () => {
    it("parses structured comment with note (plain text wrapped in RichTextDoc)", () => {
      const json = JSON.stringify({ n: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Key move!" }] }] } });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const e4 = r.mainLine[0];
      expect(e4.note).not.toBeNull();
      expect(e4.note!.content[0].content![0].text).toBe("Key move!");
    });

    it("parses structured comment with shapes (arrow)", () => {
      const json = JSON.stringify({ s: [{ kind: "arrow", from: "e2", to: "e4", color: "green" }] });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const e4 = r.mainLine[0];
      expect(e4.shapes).toHaveLength(1);
      expect(e4.shapes[0]).toEqual({ kind: "arrow", from: "e2", to: "e4", color: "green" });
    });

    it("parses structured comment with shapes (circle)", () => {
      const json = JSON.stringify({ s: [{ kind: "circle", square: "e4", color: "red" }] });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const e4 = r.mainLine[0];
      expect(e4.shapes[0]).toEqual({ kind: "circle", square: "e4", color: "red" });
    });

    it("parses structured comment with purpose=correct", () => {
      const json = JSON.stringify({ p: "correct" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      expect(r.mainLine[0].purpose).toBe("correct");
    });

    it("parses structured comment with purpose=mistake", () => {
      const json = JSON.stringify({ p: "mistake" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      expect(r.mainLine[0].purpose).toBe("mistake");
    });

    it("omitted keys in structured comment default to null/empty", () => {
      const json = JSON.stringify({ p: "correct" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const e4 = r.mainLine[0];
      expect(e4.note).toBeNull();
      expect(e4.shapes).toEqual([]);
    });

    it("structured comment with all fields populated", () => {
      const doc: RichTextDoc = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "Bold text", marks: [{ type: "bold" }] },
          ],
        }],
      };
      const shapes: Shape[] = [
        { kind: "arrow", from: "d1", to: "h5", color: "blue" },
        { kind: "circle", square: "f7", color: "red" },
      ];
      const json = JSON.stringify({ n: doc, s: shapes, p: "correct" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const e4 = r.mainLine[0];
      expect(e4.note).toEqual(doc);
      expect(e4.shapes).toEqual(shapes);
      expect(e4.purpose).toBe("correct");
    });

    it("annotation shim on structured comment node returns flattened text", () => {
      const doc: RichTextDoc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Key move!" }] }],
      };
      const json = JSON.stringify({ n: doc });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      expect(r.mainLine[0].annotation).toBe("Key move!");
    });

    it("annotation shim on node with only shapes returns undefined (no text)", () => {
      const json = JSON.stringify({ s: [{ kind: "circle", square: "e4", color: "green" }] });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      // No note → annotation shim returns undefined
      expect(r.mainLine[0].annotation).toBeUndefined();
    });
  });

  // ── Slice 3: PgnParseResult aggregates ───────────────────────────────────────

  describe("PgnParseResult aggregates: hasShapes + mistakeNodes", () => {
    it("hasShapes=false when no nodes have shapes", () => {
      const r = parsePgn("1. e4 {plain text} e5");
      expect(r.hasShapes).toBe(false);
    });

    it("hasShapes=true when at least one node has a shape", () => {
      const json = JSON.stringify({ s: [{ kind: "circle", square: "e4", color: "green" }] });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      expect(r.hasShapes).toBe(true);
    });

    it("mistakeNodes=[] when no nodes have purpose=mistake", () => {
      const r = parsePgn("1. e4 e5");
      expect(r.mistakeNodes).toEqual([]);
    });

    it("mistakeNodes contains nodes with purpose=mistake", () => {
      const json = JSON.stringify({ p: "mistake" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      expect(r.mistakeNodes).toHaveLength(1);
      expect(r.mistakeNodes[0].san).toBe("e4");
    });

    it("mistakeNodes does not include purpose=correct nodes", () => {
      const json = JSON.stringify({ p: "correct" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      expect(r.mistakeNodes).toHaveLength(0);
    });
  });

  // ── Slice 4: existing tests still pass (linear PGN unchanged) ────────────────

  describe("backward compat — linear PGN unchanged", () => {
    it("linear PGN with no structured comments produces identical tree structure", () => {
      const r = parsePgn("1. e4 e5 2. Nf3 Nc6");
      expect(r.valid).toBe(true);
      expect(r.mainLine.length).toBe(4);
      expect(r.mainLine[0].san).toBe("e4");
      expect(r.variationCount).toBe(0);
    });

    it("all existing fixture files still parse correctly (smoke test)", () => {
      const fixtures = [
        "italian-game.pgn",
        "edge-annotations-in-variations.pgn",
        "edge-promotion-variations.pgn",
        "edge-nested-variations.pgn",
      ];
      for (const name of fixtures) {
        const r = parsePgn(loadFixture(name));
        expect(r.valid).toBe(true);
      }
    });
  });

  // ── Slice 5: New fixture files ────────────────────────────────────────────────

  describe("new fixture files", () => {
    it("parses puzzle-with-mistakes.pgn correctly", () => {
      const r = parsePgn(loadFixture("puzzle-with-mistakes.pgn"));
      expect(r.valid).toBe(true);
      expect(r.mistakeNodes.length).toBeGreaterThan(0);
    });

    it("parses lesson-with-shapes.pgn and hasShapes=true", () => {
      const r = parsePgn(loadFixture("lesson-with-shapes.pgn"));
      expect(r.valid).toBe(true);
      expect(r.hasShapes).toBe(true);
    });

    it("parses custom-fen-endgame.pgn and the FEN tag is stored in root.startingFen", () => {
      const r = parsePgn(loadFixture("custom-fen-endgame.pgn"));
      expect(r.valid).toBe(true);
      expect(r.startingFen).toBeTruthy();
      expect(r.startingFen).not.toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    });

    it("parses lesson-with-rich-notes.pgn with bold and italic marks preserved", () => {
      const r = parsePgn(loadFixture("lesson-with-rich-notes.pgn"));
      expect(r.valid).toBe(true);
      // At least one node should have a note with marks
      const nodesWithMarks = [...r.nodeMap.values()].filter(
        (n) => n.note !== null && n.note.content.some(
          (para) => para.content?.some((text) => text.marks && text.marks.length > 0)
        )
      );
      expect(nodesWithMarks.length).toBeGreaterThan(0);
    });
  });
});

// ── serializePgn tests ────────────────────────────────────────────────────────

describe("serializePgn (issue #191)", () => {
  describe("basic serialization", () => {
    it("serializes a linear PGN tree back to a PGN string", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      const serialized = serializePgn(r.root!);
      expect(serialized).toBeTruthy();
      // Reparsing should produce the same tree structure
      const r2 = parsePgn(serialized);
      expect(r2.valid).toBe(true);
      expect(r2.mainLine.length).toBe(r.mainLine.length);
      expect(r2.mainLine.map((n) => n.san)).toEqual(r.mainLine.map((n) => n.san));
    });

    it("serializes variations into (...) brackets", () => {
      const r = parsePgn("1. e4 e5 (1...c5) 2. Nf3");
      const serialized = serializePgn(r.root!);
      const r2 = parsePgn(serialized);
      expect(r2.valid).toBe(true);
      const e4Node = r2.root!.children[0];
      expect(e4Node.children.length).toBe(2);
      expect(e4Node.children[0].san).toBe("e5");
      expect(e4Node.children[1].san).toBe("c5");
    });

    it("does NOT emit a comment for nodes with no note, shapes, or purpose", () => {
      const r = parsePgn("1. e4 e5");
      const serialized = serializePgn(r.root!);
      expect(serialized).not.toContain("{");
    });

    it("emits a comment for nodes with a legacy plain-text note", () => {
      const r = parsePgn("1. e4 {A good move} e5");
      const serialized = serializePgn(r.root!);
      expect(serialized).toContain("{");
      // Round-trip: re-parsed node.annotation is the same text
      const r2 = parsePgn(serialized);
      expect(r2.mainLine[0].annotation).toBe("A good move");
    });

    it("emits [gambitly:v1] comment for nodes with shapes", () => {
      const json = JSON.stringify({ s: [{ kind: "circle", square: "e4", color: "green" }] });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const serialized = serializePgn(r.root!);
      expect(serialized).toContain("[gambitly:v1]");
    });

    it("emits [gambitly:v1] comment for nodes with purpose", () => {
      const json = JSON.stringify({ p: "mistake" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r = parsePgn(pgn);
      const serialized = serializePgn(r.root!);
      expect(serialized).toContain("[gambitly:v1]");
    });
  });

  describe("round-trip invariant", () => {
    // parse(serialize(tree)) ≡ tree over ≥8 fixture inputs
    const linearFixtures = [
      "1. e4 e5 2. Nf3 Nc6",
      "1. d4 d5 2. c4",
      "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4",
      "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O",
    ];

    for (const pgn of linearFixtures) {
      it(`round-trips: ${pgn.slice(0, 30)}...`, () => {
        const r1 = parsePgn(pgn);
        const serialized = serializePgn(r1.root!);
        const r2 = parsePgn(serialized);
        expect(r2.valid).toBe(true);
        expect(r2.mainLine.map((n) => n.san)).toEqual(r1.mainLine.map((n) => n.san));
        expect(r2.mainLine.map((n) => n.from)).toEqual(r1.mainLine.map((n) => n.from));
        expect(r2.mainLine.map((n) => n.to)).toEqual(r1.mainLine.map((n) => n.to));
      });
    }

    it("round-trips a PGN with variations (tree branching preserved)", () => {
      const pgn = "1. e4 e5 (1...c5 2. Nf3) 2. Nf3";
      const r1 = parsePgn(pgn);
      const serialized = serializePgn(r1.root!);
      const r2 = parsePgn(serialized);
      expect(r2.variationCount).toBe(r1.variationCount);
      const e4_1 = r1.root!.children[0];
      const e4_2 = r2.root!.children[0];
      expect(e4_2.children.length).toBe(e4_1.children.length);
    });

    it("round-trips a PGN with shapes and purpose", () => {
      const shapes: Shape[] = [{ kind: "arrow", from: "e2", to: "e4", color: "green" }];
      const json = JSON.stringify({ s: shapes, p: "correct" });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r1 = parsePgn(pgn);
      const serialized = serializePgn(r1.root!);
      const r2 = parsePgn(serialized);
      expect(r2.mainLine[0].shapes).toEqual(shapes);
      expect(r2.mainLine[0].purpose).toBe("correct");
    });

    it("round-trips a PGN with rich-text notes (bold + italic marks)", () => {
      const doc: RichTextDoc = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "Bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
          ],
        }],
      };
      const json = JSON.stringify({ n: doc });
      const pgn = `1. e4 {[gambitly:v1]${json}} e5`;
      const r1 = parsePgn(pgn);
      const serialized = serializePgn(r1.root!);
      const r2 = parsePgn(serialized);
      expect(r2.mainLine[0].note).toEqual(doc);
    });

    it("round-trips all 4 new fixture files", () => {
      const newFixtures = [
        "puzzle-with-mistakes.pgn",
        "lesson-with-shapes.pgn",
        "custom-fen-endgame.pgn",
        "lesson-with-rich-notes.pgn",
      ];
      for (const name of newFixtures) {
        const pgn = loadFixture(name);
        const r1 = parsePgn(pgn);
        expect(r1.valid).toBe(true);
        const serialized = serializePgn(r1.root!, r1.startingFen);
        const r2 = parsePgn(serialized);
        expect(r2.valid).toBe(true);
        expect(r2.mainLine.map((n) => n.san)).toEqual(r1.mainLine.map((n) => n.san));
      }
    });

    it("MAX_PGN_CHARS remains 50000 (no change)", () => {
      expect(MAX_PGN_CHARS).toBe(50000);
    });
  });

  describe("FEN tag pair emission", () => {
    it("emits [FEN ...] tag when startingFen is provided and non-default", () => {
      const customFen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
      const r = parsePgn(`[FEN "${customFen}"]
1. Ke2`);
      const serialized = serializePgn(r.root!, r.startingFen);
      expect(serialized).toContain('[FEN "');
    });

    it("does NOT emit [FEN ...] tag when startingFen is null", () => {
      const r = parsePgn("1. e4 e5");
      const serialized = serializePgn(r.root!, null);
      expect(serialized).not.toContain("[FEN");
    });
  });
});
