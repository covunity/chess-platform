import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded bg-(--surface-3)', className)}
      {...props}
    />
  )
}
