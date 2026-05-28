/**
 * LessonEditor tests
 *
 * PRD-0004 Slice 5a: Tests that asserted on the PGN textarea have been updated.
 * The chess tab now uses BoardAuthoringSurface (board-direct authoring).
 * PGN textarea tests for advanced mode are deferred to the follow-up #198 test suite.
 */
import { vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock('chessground')

// Stub VideoLessonEditor — renders a minimal drop-zone placeholder and
// exposes onIsUploadingChange so tests can drive the upload state directly.
let capturedOnIsUploadingChange: ((v: boolean) => void) | undefined
vi.mock('../VideoLessonEditor', () => ({
  default: (props: { onIsUploadingChange?: (v: boolean) => void; lesson: unknown; onLessonChange: unknown }) => {
    capturedOnIsUploadingChange = props.onIsUploadingChange
    return <div data-testid="video-lesson-editor-stub" />
  },
}))

import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import i18n from "../../../i18n";
import LessonEditor, { type LessonEditorProps } from "../LessonEditor";

const DEFAULT_LESSON = {
  id: "lesson-1",
  title: "Italian Game",
  pgn_data: "",
  board_perspective: "white" as const,
  is_free_preview: false,
  type: "chess" as const,
};

function renderEditor(props: LessonEditorProps) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <I18nextProvider i18n={i18n}>
          <LessonEditor {...props} />
        </I18nextProvider>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("LessonEditor", () => {
  describe("layout", () => {
    it("renders BoardAuthoringSurface for chess type lessons (PGN textarea is gone)", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      // BoardAuthoringSurface is the replacement for the PGN textarea
      expect(screen.getByTestId("board-authoring-surface")).toBeInTheDocument();
      // PGN textarea should NOT be present
      expect(screen.queryByRole("textbox", { name: /pgn/i })).not.toBeInTheDocument();
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

    it("renders Save draft button", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByRole("button", { name: /lưu nháp/i })).toBeInTheDocument();
    });

    // ADR-0008: Submit-for-review button removed — creators self-publish.
    it("does NOT render a Submit-for-review button", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.queryByRole("button", { name: /gửi duyệt/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId("lesson-editor-submit-review-btn")).not.toBeInTheDocument();
    });

    it("renders the variation panel for chess lessons", () => {
      renderEditor({ lesson: DEFAULT_LESSON, onSave: vi.fn() });
      expect(screen.getByText(/cây nước đi/i)).toBeInTheDocument();
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

  describe("restore on reopen", () => {
    it("loads moves from lesson.pgn_data into the board authoring surface", async () => {
      renderEditor({
        lesson: { ...DEFAULT_LESSON, pgn_data: "1. e4 e5" },
        onSave: vi.fn(),
      });
      // The variation list should appear (since there are moves)
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
      expect(screen.getByTestId("variation-list")).toHaveTextContent("e4");
    });

    it("restores board perspective from lesson data", () => {
      renderEditor({
        lesson: { ...DEFAULT_LESSON, board_perspective: "black" },
        onSave: vi.fn(),
      });
      const blackBtn = screen.getByRole("button", { name: /^đen$/i });
      expect(blackBtn).toHaveAttribute("aria-pressed", "true");
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

  describe("variation tree — via BoardAuthoringSurface (Slice 5a)", () => {
    const VARIATION_PGN = "1. e4 e5 (1...c5 2. Nf3) 2. Nf3";

    it("variation list panel renders for PGN with variations", async () => {
      renderEditor({ lesson: { ...DEFAULT_LESSON, pgn_data: VARIATION_PGN }, onSave: vi.fn() });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
    });

    it("variation list contains all move SANs including variation nodes", async () => {
      renderEditor({ lesson: { ...DEFAULT_LESSON, pgn_data: VARIATION_PGN }, onSave: vi.fn() });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
      expect(screen.getByTestId("variation-list")).toHaveTextContent("c5");
    });

    it("clicking a variation node does not crash the editor", async () => {
      renderEditor({ lesson: { ...DEFAULT_LESSON, pgn_data: VARIATION_PGN }, onSave: vi.fn() });
      await waitFor(() => {
        expect(screen.getByTestId("variation-list")).toBeInTheDocument();
      });
      // Click the first board-authoring node — should not crash
      const varNodes = screen.getAllByTestId(/variation-node-/);
      expect(() => fireEvent.click(varNodes[0])).not.toThrow();
      // Preview pane still present
      expect(screen.getByTestId("lesson-preview-pane")).toBeInTheDocument();
    });
  });

  describe("save", () => {
    it("calls onSave with pgn_data serialized from tree, board_perspective, is_free_preview when Save draft is clicked", async () => {
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
          pgn_data: expect.any(String),
          board_perspective: "white",
          is_free_preview: false,
        })
      );
    });
  });

  describe("save while upload in progress", () => {
    const VIDEO_LESSON = {
      ...DEFAULT_LESSON,
      type: "video" as const,
      video_status: "idle" as const,
    };

    it("does NOT call onSave when video upload is in progress", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      renderEditor({ lesson: VIDEO_LESSON, onSave });

      // Switch to video tab
      await user.click(screen.getByTestId("lesson-type-tab-video"));

      // Trigger uploading state via the captured callback
      await act(async () => {
        capturedOnIsUploadingChange?.(true);
      });

      const saveBtn = screen.getByRole("button", { name: /lưu nháp/i });
      await user.click(saveBtn);

      expect(onSave).not.toHaveBeenCalled();
    });

    it("shows warning banner when Save is clicked while upload is in progress", async () => {
      vi.useFakeTimers();
      try {
        const onSave = vi.fn();
        renderEditor({ lesson: VIDEO_LESSON, onSave });

        // Switch to video tab
        await act(async () => { fireEvent.click(screen.getByTestId("lesson-type-tab-video")); });

        await act(async () => {
          capturedOnIsUploadingChange?.(true);
        });

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /lưu nháp/i })); });

        expect(screen.getByTestId("save-while-uploading-warning")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("warning banner disappears after 4 seconds", async () => {
      vi.useFakeTimers();
      try {
        const onSave = vi.fn();
        renderEditor({ lesson: VIDEO_LESSON, onSave });

        await act(async () => { fireEvent.click(screen.getByTestId("lesson-type-tab-video")); });

        await act(async () => {
          capturedOnIsUploadingChange?.(true);
        });

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /lưu nháp/i })); });

        expect(screen.getByTestId("save-while-uploading-warning")).toBeInTheDocument();

        await act(async () => {
          vi.advanceTimersByTime(4000);
        });

        expect(screen.queryByTestId("save-while-uploading-warning")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("calls onSave normally when no upload is in progress", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      renderEditor({ lesson: VIDEO_LESSON, onSave });

      await user.click(screen.getByTestId("lesson-type-tab-video"));

      const saveBtn = screen.getByRole("button", { name: /lưu nháp/i });
      await user.click(saveBtn);

      expect(onSave).toHaveBeenCalled();
      expect(screen.queryByTestId("save-while-uploading-warning")).not.toBeInTheDocument();
    });
  });
});
