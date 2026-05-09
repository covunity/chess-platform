export type AccessDecision = 'allow' | 'allow-admin' | 'paywall' | 'pending-paywall'

export function canAccessLesson(
  userRole: string | null | undefined,
  isEnrolled: boolean,
  lesson: { free_preview: boolean },
  hasPendingOrder = false
): AccessDecision {
  if (lesson.free_preview) return 'allow'
  if (isEnrolled) return 'allow'
  if (userRole === 'admin') return 'allow-admin'
  if (hasPendingOrder) return 'pending-paywall'
  return 'paywall'
}
