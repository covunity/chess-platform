import { useStore } from 'zustand'
import { liveClassroomStore, type LiveClassroomState } from './liveClassroomStore'

export function useLiveClassroomStore<T>(selector: (state: LiveClassroomState) => T): T {
  return useStore(liveClassroomStore, selector)
}

export { liveClassroomStore }
export type { LiveClassroomState }
