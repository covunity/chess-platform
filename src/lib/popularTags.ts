// Popular topic tags shown on the home page filter and offered as defaults
// in the creator tag dropdown. The `key` is the value stored in
// `courses.tags`, the `labelKey` is the i18n key for display text.
export interface PopularTag {
  key: string
  labelKey: string
}

export const POPULAR_TAGS: PopularTag[] = [
  { key: 'openings',     labelKey: 'home.tagOpenings' },
  { key: 'tactics',      labelKey: 'home.tagTactics' },
  { key: 'endgame',      labelKey: 'home.tagEndgame' },
  { key: 'strategy',     labelKey: 'home.tagStrategy' },
]
