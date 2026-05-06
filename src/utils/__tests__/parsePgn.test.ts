import { parsePgn } from "../parsePgn";

const SAMPLE_PGN = `1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
4. c3 Nf6 {The mainline. Black contests the center immediately.}
5. d3 d6 {Instead of the classical 5.d4 break, modern theory has shifted toward d3, preparing a slow build with Nbd2, Re1, h3.}
6. Nbd2 a6
7. Bb3 O-O
8. h3 {Prophylactic — preventing ...Bg4.}`;

describe("parsePgn", () => {
  describe("valid PGN", () => {
    it("returns valid: true for a correct PGN", () => {
      const result = parsePgn(SAMPLE_PGN);
      expect(result.valid).toBe(true);
    });

    it("counts moves correctly", () => {
      const result = parsePgn(SAMPLE_PGN);
      // 8 full moves = 15 plies (8 white + 7 black? Let's count:
      // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3 d6 6.Nbd2 a6 7.Bb3 O-O 8.h3
      // = 15 half-moves
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
      // FEN for the final position after 8.h3
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
      const pgnWithCastle =
        "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6";
      const result = parsePgn(pgnWithCastle);
      expect(result.valid).toBe(true);
    });

    it("supports en passant", () => {
      // 1.e4 e5 2.e5 d5 (wrong - en passant needs pawn side by side)
      // A proper en passant sequence:
      const pgnWithEnPassant =
        "1. e4 d5 2. e5 f5 3. exf6";
      const result = parsePgn(pgnWithEnPassant);
      expect(result.valid).toBe(true);
    });

    it("supports promotion", () => {
      // Construct a promotion sequence using a known setup
      // Simplest: Scholar's mate path that ends with promotion is complex,
      // let's use a pre-promotion PGN
      const pgnWithPromotion =
        "1. e4 d5 2. e5 f5 3. exf6 e6 4. fxg7 Nf6 5. gxh8=Q";
      const result = parsePgn(pgnWithPromotion);
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
      // First annotation is after move 4 (Nf6)
      expect(result.annotations[0].moveNumber).toBe(4);
    });

    it("handles PGN with no annotations", () => {
      const result = parsePgn("1. e4 e5 2. Nf3 Nc6");
      expect(result.annotationCount).toBe(0);
      expect(result.annotations).toEqual([]);
    });
  });
});
