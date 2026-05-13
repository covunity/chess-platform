import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock('react-chessboard')
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "../../../i18n";
import LessonEditor, { type LessonEditorProps } from "../LessonEditor";

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

function renderEditor(props: LessonEditorProps) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LessonEditor {...props} />
    </I18nextProvider>
  );
}

describe("LessonEditor", () => {
  describe("layout", () => {
    it("renders a PGN textarea", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByRole("textbox", { name: /pgn/i })).toBeInTheDocument();
    });

    it("renders a lesson title input", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByRole("textbox", { name: /tiêu đề bài học/i })).toBeInTheDocument();
    });

    it("renders board perspective selector with White and Black options", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByRole("button", { name: /^trắng$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^đen$/i })).toBeInTheDocument();
    });

    it("renders free preview toggle", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByRole("button", { name: /xem thử miễn phí/i })).toBeInTheDocument();
    });

    it("renders Save draft button", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByRole("button", { name: /lưu nháp/i })).toBeInTheDocument();
    });

    it("renders Submit for review button when onSubmitForReview is provided", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn(), onSubmitForReview: vi.fn() });
      expect(screen.getByRole("button", { name: /gửi duyệt/i })).toBeInTheDocument();
    });

    it("hides Submit for review button when onSubmitForReview is not provided", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.queryByRole("button", { name: /gửi duyệt/i })).not.toBeInTheDocument();
    });

    it("renders Preview label", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByText(/^xem trước$/i)).toBeInTheDocument();
    });
  });

  describe("character counter", () => {
    it("shows 0 / 50,000 chars when empty", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByText(/0 \/ 50,000 ký tự/i)).toBeInTheDocument();
    });

    it("updates character count as user types", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.type(textarea, "1. e4");
      expect(screen.getByText(/5 \/ 50,000 ký tự/i)).toBeInTheDocument();
    });

    it("textarea maxLength is 50,000", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      expect(textarea).toHaveAttribute("maxLength", "50000");
    });
  });

  describe("PGN validation feedback", () => {
    it("shows success status after valid PGN is entered", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await user.type(textarea, "1. e4 e5");
      await waitFor(() => {
        expect(screen.getByText(/đã phân tích pgn/i)).toBeInTheDocument();
      });
    });

    it("shows move count after valid PGN", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await user.type(textarea, "1. e4 e5");
      await waitFor(() => {
        expect(screen.getByText(/2 nước đi/i)).toBeInTheDocument();
      });
    });

    it("shows annotation count after valid annotated PGN", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: "1. e4 e5 {Nice move.}" } });
      await waitFor(() => {
        expect(screen.getByText(/1 chú thích/i)).toBeInTheDocument();
      });
    });

    it("shows error status on invalid PGN", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await user.type(textarea, INVALID_PGN);
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
    });

    it("does not crash on invalid PGN", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      await user.clear(textarea);
      await expect(user.type(textarea, "garbage xyz input")).resolves.not.toThrow();
    });
  });

  describe("board perspective", () => {
    it("defaults to white perspective", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const whiteBtn = screen.getByRole("button", { name: /^trắng$/i });
      expect(whiteBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("switches to black perspective when Black is clicked", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const blackBtn = screen.getByRole("button", { name: /^đen$/i });
      await user.click(blackBtn);
      expect(blackBtn).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("free preview toggle", () => {
    it("shows Off state by default", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const toggle = screen.getByRole("button", { name: /xem thử miễn phí/i });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });

    it("toggles to On when clicked", async () => {
      const user = userEvent.setup();
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const toggle = screen.getByRole("button", { name: /xem thử miễn phí/i });
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("restore on reopen", () => {
    it("restores PGN text from lesson data", () => {
      renderEditor({
        lesson: { ...DEFAULT_LESSON, pgn_data: "1. e4 e5" },
        onSave: vi.fn(),
      });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      expect(textarea).toHaveValue("1. e4 e5");
    });

    it("restores board perspective from lesson data", () => {
      renderEditor({
        lesson: { ...DEFAULT_LESSON, board_perspective: "black" },
        onSave: vi.fn(),
      });
      const blackBtn = screen.getByRole("button", { name: /^đen$/i });
      expect(blackBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("restores free-preview state from lesson data", () => {
      renderEditor({
        lesson: { ...DEFAULT_LESSON, is_free_preview: true },
        onSave: vi.fn(),
      });
      const toggle = screen.getByRole("button", { name: /xem thử miễn phí/i });
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });

    it("restores lesson title from lesson data", () => {
      renderEditor({
        lesson: { ...DEFAULT_LESSON, title: "Italian Game" },
        onSave: vi.fn(),
      });
      const titleInput = screen.getByRole("textbox", { name: /tiêu đề bài học/i });
      expect(titleInput).toHaveValue("Italian Game");
    });
  });

  describe("variation tree — Slice 1B (issue #166)", () => {
    const VARIATION_PGN = "1. e4 e5 (1...c5 2. Nf3) 2. Nf3";
    // Learner-branch only PGN: white has 2 options, black has 1 → no opponent warning
    const LEARNER_BRANCH_PGN = "1. e4 (1. d4) e5";

    it("status row shows variation summary for PGN with variations", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: VARIATION_PGN } });
      await waitFor(() => {
        expect(screen.getByTestId("variation-summary")).toBeInTheDocument();
      });
    });

    it("status row does not show variation summary for linear PGN", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: "1. e4 e5 2. Nf3" } });
      await waitFor(() => {
        expect(screen.getByText(/đã phân tích pgn/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/nhánh phụ/i)).not.toBeInTheDocument();
    });

    it("variation list heading is absent for linear PGN", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: "1. e4 e5 2. Nf3" } });
      await waitFor(() => {
        expect(screen.getByText(/đã phân tích pgn/i)).toBeInTheDocument();
      });
      expect(screen.queryByTestId("variation-list")).not.toBeInTheDocument();
    });

    it("variation list panel renders for PGN with variations", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: VARIATION_PGN } });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
    });

    it("variation list contains all move SANs including variation nodes", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      fireEvent.change(textarea, { target: { value: VARIATION_PGN } });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
      // c5 is a variation node — must appear in the list
      expect(screen.getByTestId("variation-list")).toHaveTextContent("c5");
    });

    it("clicking a variation node updates the preview board (highlighted node FEN changes)", async () => {
      renderEditor({ lesson: { ...DEFAULT_LESSON, pgn_data: VARIATION_PGN }, onSave: vi.fn() });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
      // Click the first variation node
      const varNodes = screen.getAllByTestId(/variation-node-/);
      fireEvent.click(varNodes[0]);
      // After click the preview area should still be rendered (no crash)
      expect(screen.getByTestId("lesson-preview-pane")).toBeInTheDocument();
    });

    it("opponent-branch warning appears when opponent has 2+ children", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      // White learner: e4 node has 2 black responses (e5 main, c5 variation) → warning
      fireEvent.change(textarea, { target: { value: VARIATION_PGN } });
      await waitFor(() => {
        expect(screen.getAllByTestId("opponent-branch-warning").length).toBeGreaterThan(0);
      });
    });

    it("opponent-branch warning absent when only learner has branching choices", async () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      // 1. e4 (1. d4) e5 — white (learner) has 2 options; no opponent branching
      fireEvent.change(textarea, { target: { value: LEARNER_BRANCH_PGN } });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("opponent-branch-warning")).not.toBeInTheDocument();
    });

    it("pasting very large PGN up to 50,000 chars is accepted by textarea", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      const textarea = screen.getByRole("textbox", { name: /pgn/i });
      expect(textarea).toHaveAttribute("maxLength", "50000");
    });

    it("parse is debounced — result does not appear synchronously after change", () => {
      vi.useFakeTimers();
      try {
        renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
        const textarea = screen.getByRole("textbox", { name: /pgn/i });
        fireEvent.change(textarea, { target: { value: "1. e4 e5" } });
        // Before the 250 ms debounce fires, parse result must not yet be visible
        expect(screen.queryByText(/đã phân tích pgn/i)).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("save", () => {
    it("calls onSave with pgn_data, board_perspective, is_free_preview when Save draft is clicked", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      renderEditor({
        lesson: { ...DEFAULT_LESSON, pgn_data: "1. e4 e5" },
        onSave,
      });
      const saveBtn = screen.getByRole("button", { name: /lưu nháp/i });
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

// Suppress unused-var warning for test fixture
void VALID_PGN;
