import { readFileSync, existsSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(__dirname, "../../../supabase/migrations");

function readMigration(name: string): string {
  const path = join(MIGRATIONS_DIR, name);
  if (!existsSync(path)) throw new Error(`Migration not found: ${name}`);
  return readFileSync(path, "utf-8");
}

// ── Migration 040: lesson_authoring_fields ───────────────────────────────────

describe("Migration 040 — lesson_authoring_fields", () => {
  let sql: string;
  beforeAll(() => { sql = readMigration("040_lesson_authoring_fields.sql"); });

  it("adds starting_fen as nullable text column on lessons", () => {
    expect(sql).toMatch(/ALTER TABLE.*lessons/i);
    expect(sql).toMatch(/starting_fen\s+text/i);
    // nullable — no NOT NULL
    expect(sql).not.toMatch(/starting_fen\s+text\s+NOT NULL/i);
  });

  it("adds a CHECK constraint on starting_fen for FEN shape", () => {
    expect(sql).toMatch(/CHECK.*starting_fen/is);
  });

  it("adds puzzle_player_side with white/black constraint", () => {
    expect(sql).toMatch(/puzzle_player_side/i);
    expect(sql).toMatch(/IN\s*\('white',\s*'black'\)|IN\s*\('black',\s*'white'\)/i);
  });

  it("adds is_view_only as boolean NOT NULL DEFAULT false", () => {
    expect(sql).toMatch(/is_view_only\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  });
});

// ── Migration 041: lesson_progress_last_node ─────────────────────────────────

describe("Migration 041 — lesson_progress_last_node", () => {
  let sql: string;
  beforeAll(() => { sql = readMigration("041_lesson_progress_last_node.sql"); });

  it("adds last_viewed_node_id to lesson_progress", () => {
    expect(sql).toMatch(/ALTER TABLE.*lesson_progress/i);
    expect(sql).toMatch(/last_viewed_node_id\s+text/i);
  });

  it("makes last_viewed_node_id nullable", () => {
    expect(sql).not.toMatch(/last_viewed_node_id\s+text\s+NOT NULL/i);
  });
});

// ── Migration 042: puzzle_attempts ───────────────────────────────────────────

describe("Migration 042 — puzzle_attempts", () => {
  let sql: string;
  beforeAll(() => { sql = readMigration("042_puzzle_attempts.sql"); });

  it("creates puzzle_attempts table", () => {
    expect(sql).toMatch(/CREATE TABLE.*puzzle_attempts/i);
  });

  it("has required columns", () => {
    expect(sql).toMatch(/user_id\s+uuid/i);
    expect(sql).toMatch(/lesson_id\s+uuid/i);
    expect(sql).toMatch(/wrong_attempts\s+int/i);
    expect(sql).toMatch(/duration_seconds\s+int/i);
    expect(sql).toMatch(/completed_at\s+timestamptz/i);
  });

  it("has composite primary key on (user_id, lesson_id, completed_at)", () => {
    expect(sql).toMatch(/PRIMARY KEY\s*\(\s*user_id\s*,\s*lesson_id\s*,\s*completed_at\s*\)/i);
  });

  it("creates puzzle_best_attempt view with min(wrong_attempts)", () => {
    expect(sql).toMatch(/CREATE.*VIEW.*puzzle_best_attempt/i);
    expect(sql).toMatch(/MIN\s*\(\s*wrong_attempts\s*\)/i);
    expect(sql).toMatch(/GROUP BY.*user_id.*lesson_id|GROUP BY.*lesson_id.*user_id/i);
  });

  it("enables RLS on puzzle_attempts", () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("has learner SELECT policy on own rows", () => {
    expect(sql).toMatch(/FOR\s+SELECT/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
  });

  it("has learner INSERT policy", () => {
    expect(sql).toMatch(/FOR\s+INSERT/i);
  });

  it("has admin SELECT all policy", () => {
    expect(sql).toMatch(/admin/i);
  });
});

// ── Migration 043: users_editor_advanced ─────────────────────────────────────

describe("Migration 043 — users_editor_advanced", () => {
  let sql: string;
  beforeAll(() => { sql = readMigration("043_users_editor_advanced.sql"); });

  it("adds editor_advanced to users table", () => {
    expect(sql).toMatch(/ALTER TABLE.*users/i);
    expect(sql).toMatch(/editor_advanced\s+boolean/i);
  });

  it("makes editor_advanced NOT NULL DEFAULT false", () => {
    expect(sql).toMatch(/editor_advanced\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  });
});

// ── Sequential numbering ─────────────────────────────────────────────────────

describe("Migration file naming", () => {
  it("all four migration files exist with sequential numbers 040–043", () => {
    const names = [
      "040_lesson_authoring_fields.sql",
      "041_lesson_progress_last_node.sql",
      "042_puzzle_attempts.sql",
      "043_users_editor_advanced.sql",
    ];
    for (const name of names) {
      expect(existsSync(join(MIGRATIONS_DIR, name))).toBe(true);
    }
  });
});
