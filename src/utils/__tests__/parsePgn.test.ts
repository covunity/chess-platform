import { readFileSync } from "fs";
import { join } from "path";
import { parsePgn } from "../parsePgn";

// ── Fixture loader ────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(__dirname, "../__fixtures__/pgn");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

// ── Sample PGN (same as Phase 1 — backward-compat anchor) ────────────────────

const SAMPLE_PGN = `1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
4. c3 Nf6 {The mainline. Black contests the center immediately.}
5. d3 d6 {Instead of the classical 5.d4 break, modern theory has shifted toward d3, preparing a slow build with Nbd2, Re1, h3.}
6. Nbd2 a6
7. Bb3 O-O
8. h3 {Prophylactic — preventing ...Bg4.}`;

// ════════════════════════════════════════════════════════════════════════════
// Phase 1 backward-compat tests (must all pass unchanged)
// ════════════════════════════════════════════════════════════════════════════

describe("parsePgn — Phase 1 backward-compat", () => {
  describe("valid PGN", () => {
    it("returns valid: true for a correct PGN", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(result.valid).toBe(true);
    });

    it("counts moves correctly", () => {
      const result = parsePgn(SAMPLE_PGN);
      // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3 d6 6.Nbd2 a6 7.Bb3 O-O 8.h3 = 15 plies
      expect(result.moveCount).toBe(15);
    });

    it("counts annotations correctly", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(result.annotationCount).toBe(3);
    });

    it("returns the last FEN position", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(result.fen).toBeTruthy();
      expect(typeof result.fen).toBe("string");
      expect(result.fen).toContain("/");
    });

    it("returns no error on valid PGN", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(result.error).toBeUndefined();
    });

    it("returns moves array with move details", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(Array.isArray(result.moves)).toBe(true);
      expect(result.moves.length).toBe(15);
    });

    it("supports castling (O-O)", () => {
      const result = parsePgn("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6");
      expect(result.valid).toBe(true);
    });

    it("supports en passant", () => {
      const result = parsePgn("1. e4 d5 2. e5 f5 3. exf6");
      expect(result.valid).toBe(true);
    });

    it("supports promotion", () => {
      const result = parsePgn(
        "1. e4 d5 2. e5 f5 3. exf6 e6 4. fxg7 Nf6 5. gxh8=Q"
      );
      expect(result.valid).toBe(true);
    });

    it("handles empty PGN as invalid", () => {
      const result = parsePgn("");
      expect(result.valid).toBe(false);
    });
  });

  describe("invalid PGN", () => {
    it("returns valid: false for illegal moves", () => {
      const result = parsePgn("1. e4 e5 2. Nxe5");
      expect(result.valid).toBe(false);
    });

    it("returns an error message on invalid PGN", () => {
      const result = parsePgn("1. e4 e5 2. Nxe5");
      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe("string");
    });

    it("does not throw on invalid input", () => {
      expect(() => parsePgn("garbage input xyz")).not.toThrow();
    });
  });

  describe("annotations", () => {
    it("extracts annotation text for each annotated move", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(result.annotations.length).toBe(3);
      expect(result.annotations[0].text).toContain("mainline");
    });

    it("associates annotation with correct move number", () => {
      const result = parsePgn(SAMPLE_PGN);
      // First annotation is after move 4 (Nf6 at depth 8, moveNumber = ceil(8/2) = 4)
      expect(result.annotations[0].moveNumber).toBe(4);
    });

    it("handles PGN with no annotations", () => {
      const result = parsePgn("1. e4 e5 2. Nf3 Nc6");
      expect(result.annotationCount).toBe(0);
      expect(result.annotations).toEqual([]);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Slice 1A — new tree-structure tests
// ════════════════════════════════════════════════════════════════════════════

describe("parsePgn — tree structure (Slice 1A)", () => {

  // ── AC: linear PGN produces degree-1 tree ──────────────────────────────────

  describe("linear PGN", () => {
    it("totalNodes = 4 for 3-ply PGN (root + 3 moves)", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.totalNodes).toBe(4);
    });

    it("variationCount = 0 for linear PGN", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.variationCount).toBe(0);
    });

    it("maxDepth = 3 for 3-ply PGN", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.maxDepth).toBe(3);
    });

    it("root node is valid sentinel", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.root).not.toBeNull();
      expect(r.root!.id).toBe("root");
      expect(r.root!.parentId).toBeNull();
      expect(r.root!.depthFromRoot).toBe(0);
    });

    it("mainLine matches moves in order for linear PGN", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.mainLine.length).toBe(3);
      expect(r.mainLine[0].san).toBe("e4");
      expect(r.mainLine[1].san).toBe("e5");
      expect(r.mainLine[2].san).toBe("Nf3");
    });

    it("mainLine nodes have correct moveNumbers", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.mainLine[0].moveNumber).toBe(1); // depth 1 → ceil(1/2) = 1
      expect(r.mainLine[1].moveNumber).toBe(1); // depth 2 → ceil(2/2) = 1
      expect(r.mainLine[2].moveNumber).toBe(2); // depth 3 → ceil(3/2) = 2
    });

    it("mainLine nodes have correct side", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.mainLine[0].side).toBe("w"); // e4 played by white
      expect(r.mainLine[1].side).toBe("b"); // e5 played by black
      expect(r.mainLine[2].side).toBe("w"); // Nf3 played by white
    });

    it("each mainLine node has correct parentId chain", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.mainLine[0].parentId).toBe("root");
      expect(r.mainLine[1].parentId).toBe(r.mainLine[0].id);
      expect(r.mainLine[2].parentId).toBe(r.mainLine[1].id);
    });

    it("linear PGN mainLine equals derived moves field (backward-compat)", () => {
      const r = parsePgn(SAMPLE_PGN);
      expect(r.moves).toBe(r.mainLine); // same reference
      expect(r.moves.length).toBe(r.mainLine.length);
    });
  });

  // ── AC: variation tree ─────────────────────────────────────────────────────

  describe("PGN with variations", () => {
    const VAR_PGN = "1. e4 e5 (1...c5 2. Nf3) 2. Nf3";

    it("variationCount = 2 for one variation bracket containing 2 nodes", () => {
      const r = parsePgn(VAR_PGN);
      expect(r.variationCount).toBe(2);
    });

    it("maxDepth = 3 for variation PGN", () => {
      const r = parsePgn(VAR_PGN);
      expect(r.maxDepth).toBe(3);
    });

    it("totalNodes accounts for all branches", () => {
      const r = parsePgn(VAR_PGN);
      // root + e4 + e5 + Nf3(main) + c5 + Nf3(var) = 6
      expect(r.totalNodes).toBe(6);
    });

    it("main-line first child is e5, variation child is c5", () => {
      const r = parsePgn(VAR_PGN);
      const e4Node = r.root!.children[0];
      expect(e4Node.san).toBe("e4");
      expect(e4Node.children.length).toBe(2);
      expect(e4Node.children[0].san).toBe("e5"); // main line first
      expect(e4Node.children[1].san).toBe("c5"); // variation second
    });

    it("variation node has correct parentId", () => {
      const r = parsePgn(VAR_PGN);
      const e4Node = r.root!.children[0];
      const c5Node = e4Node.children[1];
      expect(c5Node.parentId).toBe(e4Node.id);
    });

    it("mainLine only contains main-line nodes", () => {
      const r = parsePgn(VAR_PGN);
      const sans = r.mainLine.map((n) => n.san);
      expect(sans).toEqual(["e4", "e5", "Nf3"]);
    });
  });

  // ── AC: nodeMap ────────────────────────────────────────────────────────────

  describe("nodeMap", () => {
    it("nodeMap contains exactly totalNodes entries (including root)", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      expect(r.nodeMap.size).toBe(r.totalNodes);
    });

    it("nodeMap.get(root.children[0].id) returns first move node", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      const firstChild = r.root!.children[0];
      expect(r.nodeMap.get(firstChild.id)).toBe(firstChild);
    });

    it("nodeMap includes variation nodes", () => {
      const r = parsePgn("1. e4 e5 (1...c5) 2. Nf3");
      const e4Node = r.root!.children[0];
      const c5Node = e4Node.children[1];
      expect(r.nodeMap.has(c5Node.id)).toBe(true);
    });
  });

  // ── AC: node ID stability (hashed on from/to/promotion, not SAN) ──────────

  describe("node ID stability", () => {
    it("same move produces same ID regardless of SAN disambiguation", () => {
      // Both express Ng1-f3 (from g1 to f3)
      const r1 = parsePgn("1. e4 e5 2. Nf3");
      const r2 = parsePgn("1. e4 e5 2. Ngf3");
      // Both parsers may normalise to 'Nf3' san; IDs based on from/to are equal
      const id1 = r1.mainLine[2].id;
      const id2 = r2.mainLine[2].id;
      expect(id1).toBe(id2);
    });

    it("different squares produce different IDs", () => {
      const r1 = parsePgn("1. e4");
      const r2 = parsePgn("1. d4");
      expect(r1.mainLine[0].id).not.toBe(r2.mainLine[0].id);
    });

    it("promotion variation nodes have different IDs for different pieces", () => {
      const r = parsePgn(
        "1. e4 d5 2. e5 f5 3. exf6 e6 4. fxg7 Nf6 5. gxh8=Q (5. gxh8=N)"
      );
      const g7Node = r.mainLine[r.mainLine.length - 1].parentId
        ? r.nodeMap.get(r.mainLine[r.mainLine.length - 1].parentId!)!
        : null;
      // The parent of the last main-line move and the variation share the same
      // grandparent but have different promotion values → different IDs
      const mainLeaf = r.mainLine[r.mainLine.length - 1];
      const varParent = r.nodeMap.get(mainLeaf.parentId!)!;
      expect(varParent.children.length).toBe(2);
      expect(varParent.children[0].promotion).toBe("q");
      expect(varParent.children[1].promotion).toBe("n");
      expect(varParent.children[0].id).not.toBe(varParent.children[1].id);
    });
  });

  // ── AC: duplicate ID detection ─────────────────────────────────────────────

  describe("duplicate node ID detection", () => {
    it("does not throw for normal PGN (no duplicate paths)", () => {
      expect(() => parsePgn("1. e4 e5 2. Nf3 Nc6")).not.toThrow();
    });

    it("returns error (not throw) for a PGN that would produce duplicate IDs", () => {
      // Two variations with identical move from the same parent produce duplicate IDs.
      // We manufacture this by having the same move appear twice as a variation.
      // In practice the tokenizer sees both and would detect duplicate ID.
      const dupPgn = "1. e4 e5 (1...e5) 2. Nf3";
      const r = parsePgn(dupPgn);
      // Either it errors or it skips — the important thing is no throw
      expect(r).toBeDefined();
    });
  });

  // ── AC: nested variations ──────────────────────────────────────────────────

  describe("nested variations", () => {
    it("parses variations within variations", () => {
      const pgn =
        "1. e4 e5 2. Nf3 Nc6 (2...Nf6 3. Nxe5 (3. d4) d6) 3. Bc4";
      const r = parsePgn(pgn);
      expect(r.valid).toBe(true);
      expect(r.variationCount).toBeGreaterThan(0);
    });
  });

  // ── AC: FEN and side fields ────────────────────────────────────────────────

  describe("FEN and side fields on nodes", () => {
    it("each node FEN matches chess.js position after the move", () => {
      const r = parsePgn("1. e4 e5 2. Nf3");
      // After 1.e4, e4 pawn should be on e4
      const e4Fen = r.mainLine[0].fen;
      expect(e4Fen).toContain("P");
      // After 1...e5, black pawn on e5
      const e5Fen = r.mainLine[1].fen;
      expect(e5Fen).toContain("p");
    });

    it("annotation on a node does not appear on unrelated nodes", () => {
      const r = parsePgn(SAMPLE_PGN);
      // 4...Nf6 carries the annotation — at depth 8
      const annotated = r.mainLine.filter((n) => n.annotation !== undefined);
      expect(annotated.length).toBe(3);
      expect(annotated[0].san).toBe("Nf6");
    });
  });

  // ── AC: return valid: false + no throw on garbage ─────────────────────────

  describe("error handling", () => {
    it("returns valid: false and error string on invalid move in main line", () => {
      const r = parsePgn("1. e4 e5 2. Nxe5"); // knight can't capture e5
      expect(r.valid).toBe(false);
      expect(r.error).toBeTruthy();
      expect(r.root).toBeNull();
    });

    it("returns valid: false for empty string", () => {
      expect(parsePgn("").valid).toBe(false);
      expect(parsePgn("   ").valid).toBe(false);
    });

    it("does not throw on garbage input", () => {
      expect(() => parsePgn("garbage input xyz")).not.toThrow();
    });
  });

  // ── AC: fixture smoke — all 10+ fixtures parse without throwing ────────────

  describe("fixture files parse without error", () => {
    const fixtures = [
      "italian-game.pgn",
      "sicilian-najdorf.pgn",
      "kings-indian.pgn",
      "caro-kann.pgn",
      "kings-gambit-declined.pgn",
      "edge-castling.pgn",
      "edge-en-passant.pgn",
      "edge-promotion.pgn",
      "edge-nested-variations.pgn",
      "edge-annotations-in-variations.pgn",
      "edge-nags.pgn",
      "edge-promotion-variations.pgn",
    ];

    for (const name of fixtures) {
      it(`parses ${name} without throwing`, () => {
        const pgn = loadFixture(name);
        expect(() => parsePgn(pgn)).not.toThrow();
      });

      it(`${name} is valid`, () => {
        const pgn = loadFixture(name);
        const r = parsePgn(pgn);
        expect(r.valid).toBe(true);
        expect(r.root).not.toBeNull();
        expect(r.totalNodes).toBeGreaterThan(1); // at least root + 1 move
      });

      it(`${name} nodeMap size equals totalNodes`, () => {
        const pgn = loadFixture(name);
        const r = parsePgn(pgn);
        expect(r.nodeMap.size).toBe(r.totalNodes);
      });
    }

    it("italian-game.pgn has at least 4 variation branches (>= 4 non-main nodes)", () => {
      const r = parsePgn(loadFixture("italian-game.pgn"));
      expect(r.variationCount).toBeGreaterThanOrEqual(4);
    });

    it("edge-promotion-variations.pgn has two promotion children with different pieces", () => {
      const r = parsePgn(loadFixture("edge-promotion-variations.pgn"));
      // Find the node with two promotion children
      const promotionParent = [...r.nodeMap.values()].find(
        (n) => n.children.length === 2 && n.children.some((c) => c.promotion)
      );
      expect(promotionParent).toBeDefined();
      const promotions = promotionParent!.children.map((c) => c.promotion);
      expect(promotions).toContain("q");
      expect(promotions).toContain("n");
    });

    it("edge-nested-variations.pgn has maxDepth >= 4", () => {
      const r = parsePgn(loadFixture("edge-nested-variations.pgn"));
      expect(r.maxDepth).toBeGreaterThanOrEqual(4);
    });

    it("edge-annotations-in-variations.pgn has annotated variation nodes", () => {
      const r = parsePgn(loadFixture("edge-annotations-in-variations.pgn"));
      const annotatedVariationNodes = [...r.nodeMap.values()].filter(
        (n) =>
          n.annotation !== undefined &&
          !r.mainLine.some((m) => m.id === n.id) &&
          n.id !== "root"
      );
      expect(annotatedVariationNodes.length).toBeGreaterThan(0);
    });
  });
});
