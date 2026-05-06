import { render, screen } from "@testing-library/react";
import ChessBoard from "../ChessBoard";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("ChessBoard", () => {
  describe("rendering", () => {
    it("renders an 8x8 grid of squares", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      const squares = screen.getAllByRole("cell");
      expect(squares).toHaveLength(64);
    });

    it("renders white king (♔) in the starting position", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      expect(screen.getByText("♔")).toBeInTheDocument();
    });

    it("renders black king (♚) in the starting position", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      expect(screen.getByText("♚")).toBeInTheDocument();
    });

    it("renders all 8 white pawns in the starting position", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      const whitePawns = screen.getAllByText("♙");
      expect(whitePawns).toHaveLength(8);
    });

    it("renders all 8 black pawns in the starting position", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      const blackPawns = screen.getAllByText("♟");
      expect(blackPawns).toHaveLength(8);
    });

    it("reflects an updated position after e4", () => {
      render(<ChessBoard fen={AFTER_E4_FEN} />);
      // After e4, the e2 square should be empty, e4 should have a white pawn.
      // We only check that white still has 8 pawns (one moved)
      const whitePawns = screen.getAllByText("♙");
      expect(whitePawns).toHaveLength(8);
    });
  });

  describe("perspective", () => {
    it("renders with white perspective by default (a1 bottom-left)", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      const board = screen.getByRole("table");
      // White's back rank is rank 1 — last row in white perspective
      // We test by checking the aria-label on the board
      expect(board).toHaveAttribute("aria-label", expect.stringContaining("white"));
    });

    it("renders with black perspective when specified", () => {
      render(<ChessBoard fen={STARTING_FEN} perspective="black" />);
      const board = screen.getByRole("table");
      expect(board).toHaveAttribute("aria-label", expect.stringContaining("black"));
    });
  });

  describe("last move highlight", () => {
    it("highlights the last move squares", () => {
      render(
        <ChessBoard
          fen={AFTER_E4_FEN}
          lastMove={{ from: [6, 4], to: [4, 4] }}
        />
      );
      // e2 = row 6, col 4 (0-indexed from top in white perspective)
      // e4 = row 4, col 4
      const highlightedSquares = document.querySelectorAll("[data-last-move='true']");
      expect(highlightedSquares).toHaveLength(2);
    });

    it("does not highlight when no lastMove provided", () => {
      render(<ChessBoard fen={STARTING_FEN} />);
      const highlightedSquares = document.querySelectorAll("[data-last-move='true']");
      expect(highlightedSquares).toHaveLength(0);
    });
  });

  describe("size", () => {
    it("applies the given size in px", () => {
      render(<ChessBoard fen={STARTING_FEN} size={300} />);
      const board = screen.getByRole("table");
      expect(board).toHaveStyle({ width: "300px", height: "300px" });
    });
  });
});
