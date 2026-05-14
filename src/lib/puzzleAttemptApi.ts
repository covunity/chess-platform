import type { SupabaseClient } from '@supabase/supabase-js'

// ---- recordPuzzleAttempt ----

export interface RecordPuzzleAttemptArgs {
  lesson_id: string
  wrong_attempts: number
  duration_seconds: number
}

export interface RecordPuzzleAttemptResult {
  error: Error | null
}

/**
 * Inserts a row into `puzzle_attempts`.
 * `user_id` is resolved server-side via `auth.uid()` per the table's RLS.
 */
export async function recordPuzzleAttempt(
  client: SupabaseClient,
  { lesson_id, wrong_attempts, duration_seconds }: RecordPuzzleAttemptArgs
): Promise<RecordPuzzleAttemptResult> {
  const { data, error } = await client
    .from('puzzle_attempts')
    .insert({ lesson_id, wrong_attempts, duration_seconds })
    .select()
    .single()

  if (error) {
    return { error: new Error((error as { message?: string })?.message ?? 'Failed to record puzzle attempt') }
  }
  if (!data) {
    return { error: new Error('Failed to record puzzle attempt') }
  }
  return { error: null }
}

// ---- getBestPuzzleAttempt ----

export interface BestPuzzleAttempt {
  wrong_attempts: number
}

/**
 * Reads from `puzzle_best_attempt` view.
 * Returns `{ wrong_attempts }` if the learner has completed the puzzle before, or `null` if not.
 */
export async function getBestPuzzleAttempt(
  client: SupabaseClient,
  lessonId: string
): Promise<BestPuzzleAttempt | null> {
  const { data, error } = await client
    .from('puzzle_best_attempt')
    .select('lesson_id, wrong_attempts')
    .eq('lesson_id', lessonId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const row = data as { wrong_attempts: number }
  return { wrong_attempts: row.wrong_attempts }
}
