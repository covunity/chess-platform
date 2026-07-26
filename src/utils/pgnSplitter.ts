/**
 * Utility for parsing and splitting multi-game PGN files/strings into individual games.
 * Supports extracting lesson titles from PGN tags (ChapterName, Event, White/Black).
 */

export interface ParsedPgnGame {
  title: string
  pgn: string
  startingFen?: string | null
}

/**
 * Splits a PGN string that may contain one or multiple games into structured game objects.
 */
export function splitMultiGamePgn(pgnText: string): ParsedPgnGame[] {
  if (!pgnText || !pgnText.trim()) {
    return []
  }

  const trimmed = pgnText.trim()

  // Primary splitting strategy: split by `[Event "` tag if multiple exist
  let blocks: string[] = []

  const eventMatches = Array.from(trimmed.matchAll(/(?:^|\n)\s*\[Event\s+/gi))

  if (eventMatches.length > 1) {
    const splitIndices: number[] = eventMatches.map(m => m.index!)
    for (let i = 0; i < splitIndices.length; i++) {
      const start = splitIndices[i]
      const end = i + 1 < splitIndices.length ? splitIndices[i + 1] : trimmed.length
      const block = trimmed.substring(start, end).trim()
      if (block) blocks.push(block)
    }
  } else {
    // Check by `[ChapterName "` if no multiple `[Event "`
    const chapterMatches = Array.from(trimmed.matchAll(/(?:^|\n)\s*\[ChapterName\s+/gi))
    if (chapterMatches.length > 1) {
      const splitIndices: number[] = chapterMatches.map(m => m.index!)
      for (let i = 0; i < splitIndices.length; i++) {
        const start = splitIndices[i]
        const end = i + 1 < splitIndices.length ? splitIndices[i + 1] : trimmed.length
        const block = trimmed.substring(start, end).trim()
        if (block) blocks.push(block)
      }
    } else {
      // Fallback: split by blank lines followed by tag block `[` if moves preceded it
      const rawLines = trimmed.split('\n')
      let currentBlock: string[] = []
      let hasMoves = false

      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i]
        const isTagLine = /^\s*\[[A-Za-z0-9_]+\s+"[^"]*"\]\s*$/.test(line)

        if (isTagLine && hasMoves) {
          const blockText = currentBlock.join('\n').trim()
          if (blockText) blocks.push(blockText)
          currentBlock = []
          hasMoves = false
        }

        if (line.trim().length > 0 && !isTagLine) {
          hasMoves = true
        }

        currentBlock.push(line)
      }

      if (currentBlock.length > 0) {
        const blockText = currentBlock.join('\n').trim()
        if (blockText) blocks.push(blockText)
      }
    }
  }

  if (blocks.length === 0) {
    blocks = [trimmed]
  }

  const results: ParsedPgnGame[] = []

  blocks.forEach((gamePgn, index) => {
    const title = extractGameTitle(gamePgn, index + 1)
    const startingFen = extractStartingFen(gamePgn)

    results.push({
      title,
      pgn: gamePgn,
      startingFen,
    })
  })

  return results
}

/**
 * Extracts a descriptive lesson title from a game's PGN tags.
 */
export function extractGameTitle(gamePgn: string, fallbackNumber: number): string {
  const chapterNameMatch = gamePgn.match(/\[ChapterName\s+"([^"]+)"\]/i)
  if (chapterNameMatch && chapterNameMatch[1].trim() && chapterNameMatch[1].trim() !== '?') {
    return chapterNameMatch[1].trim()
  }

  const eventMatch = gamePgn.match(/\[Event\s+"([^"]+)"\]/i)
  if (eventMatch && eventMatch[1].trim() && eventMatch[1].trim() !== '?') {
    const eventName = eventMatch[1].trim()
    if (eventName.includes(': ')) {
      const parts = eventName.split(': ')
      const lastPart = parts[parts.length - 1].trim()
      if (lastPart) return lastPart
    }
    return eventName
  }

  const whiteMatch = gamePgn.match(/\[White\s+"([^"]+)"\]/i)
  const blackMatch = gamePgn.match(/\[Black\s+"([^"]+)"\]/i)
  const white = whiteMatch?.[1]?.trim()
  const black = blackMatch?.[1]?.trim()

  if (white && black && white !== '?' && black !== '?') {
    return `${white} vs ${black}`
  }

  return `Ván ${fallbackNumber}`
}

/**
 * Extracts FEN from [FEN "..."] tag pair if present.
 */
export function extractStartingFen(gamePgn: string): string | null {
  const fenMatch = gamePgn.match(/\[FEN\s+"([^"]+)"\]/i)
  if (fenMatch && fenMatch[1].trim() && fenMatch[1].trim() !== '?') {
    return fenMatch[1].trim()
  }
  return null
}
