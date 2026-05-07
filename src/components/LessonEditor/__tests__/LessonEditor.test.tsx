import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LessonEditor from "../LessonEditor";

const VALID_PGN = `1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
4. c3 Nf6 {The mainline. Black contests the center immediately.}
5. d3 d6 {Modern theory prefers d3.}
6. Nbd2 a6
7. Bb3 O-O
8. h3 {Prophylactic.}`;

const INVALID_PGN = "1. e4 e5 2. Nxe5";

const DEFAULT_LESSON = {
  id: "lesson-1",
  title: "Italian Game",
  pgn_data: "",
  board_perspective: "white" as const,
  is_free_preview: false,
};

describe("LessonEditor", () => {
  describe("layout", () => {
    it("renders a PGN textarea", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByRole("textbox", { name: /pgn/i })).toBeInTheDocument();
    });

    it("renders a lesson title input", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByRole("textbox", { name: /lesson title/i })).toBeInTheDocument();
    });

    it("renders board perspective selector with White and Black options", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByRole("button", { name: /^white$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^black$/i })).toBeInTheDocument();
    });

    it("renders free preview toggle", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByRole("button", { name: /free preview/i })).toBeInTheDocument();
    });

    it("renders Save draft button", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByRole("button", { name: /save draft/i })).toBeInTheDocument();
    });

    it("renders Submit for review button when onSubmitForReview is provided", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} onSubmitForReview={vi.fn()} />);
      expect(screen.getByRole("button", { name: /submit for review/i })).toBeInTheDocument();
    });

    it("hides Submit for review button when onSubmitForReview is not provided", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /submit for review/i })).not.toBeInTheDocument();
    });

    it("renders Live preview label", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByText(/live preview/i)).toBeInTheDocument();
    });
  });

  describe("character counter", () => {
    it("shows 0 / 5,000 chars when empty", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      expect(screen.getByText(/0 \/ 5,000 chars/i)).toBeInTheDocument();
    });

    it("updates character count as user types", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.type(textarea, "1. e4");
      expect(screen.getByText(/5 \/ 5,000 chars/i)).toBeInTheDocument();
    });
  });

  describe("PGN validation feedback", () => {
    it("shows success status after valid PGN is entered", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await user.type(textarea, "1. e4 e5");
      await waitFor(() => {
        expect(screen.getByText(/pgn parsed/i)).toBeInTheDocument();
      });
    });

    it("shows move count after valid PGN", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await user.type(textarea, "1. e4 e5");
      await waitFor(() => {
        expect(screen.getByText(/2 moves/i)).toBeInTheDocument();
      });
    });

    it("shows annotation count after valid annotated PGN", async () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: "1. e4 e5 {Nice move.}" } });
      await waitFor(() => {
        expect(screen.getByText(/1 annotation/i)).toBeInTheDocument();
      });
    });

    it("shows error status on invalid PGN", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await user.type(textarea, INVALID_PGN);
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
    });

    it("does not crash on invalid PGN", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await expect(user.type(textarea, "garbage xyz input")).resolves.not.toThrow();
    });
  });

  describe("board perspective", () => {
    it("defaults to white perspective", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const whiteBtn = screen.getByRole("button", { name: /^white$/i });
      expect(whiteBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("switches to black perspective when Black is clicked", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const blackBtn = screen.getByRole("button", { name: /^black$/i });
      await user.click(blackBtn);
      expect(blackBtn).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("free preview toggle", () => {
    it("shows Off state by default", () => {
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: /free preview/i });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });

    it("toggles to On when clicked", async () => {
      const user = userEvent.setup();
      render(<LessonEditor lesson={DEFAULT_LESSON} onSave={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: /free preview/i });
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("restore on reopen", () => {
    it("restores PGN text from lesson data", () => {
      render(
        <LessonEditor
          lesson={{ ...DEFAULT_LESSON, pgn_data: "1. e4 e5" }}
          onSave={vi.fn()}
        />
      );
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      expect(textarea).toHaveValue("1. e4 e5");
    });

    it("restores board perspective from lesson data", () => {
      render(
        <LessonEditor
          lesson={{ ...DEFAULT_LESSON, board_perspective: "black" }}
          onSave={vi.fn()}
        />
      );
      const blackBtn = screen.getByRole("button", { name: /^black$/i });
      expect(blackBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("restores free-preview state from lesson data", () => {
      render(
        <LessonEditor
          lesson={{ ...DEFAULT_LESSON, is_free_preview: true }}
          onSave={vi.fn()}
        />
      );
      const toggle = screen.getByRole("button", { name: /free preview/i });
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });

    it("restores lesson title from lesson data", () => {
      render(
        <LessonEditor
          lesson={{ ...DEFAULT_LESSON, title: "Italian Game" }}
          onSave={vi.fn()}
        />
      );
      const titleInput = screen.getByRole("textbox", { name: /lesson title/i });
      expect(titleInput).toHaveValue("Italian Game");
    });
  });

  describe("save", () => {
    it("calls onSave with pgn_data, board_perspective, is_free_preview when Save draft is clicked", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(
        <LessonEditor
          lesson={{ ...DEFAULT_LESSON, pgn_data: "1. e4 e5" }}
          onSave={onSave}
        />
      );
      const saveBtn = screen.getByRole("button", { name: /save draft/i });
      await user.click(saveBtn);
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          pgn_data: "1. e4 e5",
          board_perspective: "white",
          is_free_preview: false,
        })
      );
    });
  });
});
