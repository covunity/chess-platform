/**
 * One-shot post-deploy backfill: fills bookmarks.node_id for pre-PRD-0003 rows.
 *
 * For each bookmark with node_id IS NULL:
 *  - Fetch the lesson's pgn_data
 *  - Parse the PGN tree
 *  - Walk all nodes to find one whose FEN matches bookmarks.pgn_snapshot
 *  - If found, write that node's id into node_id
 *
 * Idempotent: only processes rows where node_id IS NULL. Re-running is a no-op.
 *
 * Run with: npx vite-node scripts/backfill_bookmark_node_ids.ts
 * Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in env (or a service-role key).
 */

import { createClient } from '@supabase/supabase-js'
import { parsePgn } from '../src/utils/parsePgn'

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: bookmarks, error } = await supabase
    .from('bookmarks')
    .select('id, lesson_id, pgn_snapshot')
    .is('node_id', null)

  if (error) {
    console.error('Failed to fetch bookmarks:', error.message)
    process.exit(1)
  }

  console.log(`Found ${bookmarks.length} bookmark(s) with node_id IS NULL`)

  let filled = 0
  let skipped = 0

  for (const bookmark of bookmarks) {
    const { data: lesson, error: lessonErr } = await supabase
      .from('lessons')
      .select('pgn_data')
      .eq('id', bookmark.lesson_id)
      .maybeSingle()

    if (lessonErr || !lesson?.pgn_data) {
      skipped++
      continue
    }

    const parsed = parsePgn(lesson.pgn_data)
    if (!parsed.valid || !parsed.root) {
      skipped++
      continue
    }

    // Walk all nodes to find one whose FEN matches the bookmarked FEN snapshot
    let matchedNodeId: string | null = null
    for (const [nodeId, node] of parsed.nodeMap) {
      if (nodeId === 'root') continue
      if (node.fen === bookmark.pgn_snapshot) {
        matchedNodeId = nodeId
        break
      }
    }

    if (!matchedNodeId) {
      skipped++
      continue
    }

    const { error: updateErr } = await supabase
      .from('bookmarks')
      .update({ node_id: matchedNodeId })
      .eq('id', bookmark.id)

    if (updateErr) {
      console.warn(`Failed to update bookmark ${bookmark.id}:`, updateErr.message)
      skipped++
    } else {
      filled++
    }
  }

  console.log(`Done. Filled: ${filled}, Skipped (unparseable/no match): ${skipped}`)
}

run()
