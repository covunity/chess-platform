import { cloudflareProvider } from './cloudflareProvider'
import { supabaseProvider } from './supabaseProvider'
import type { VideoProvider, VideoProviderName } from './types'

const PROVIDERS: Record<VideoProviderName, VideoProvider> = {
  supabase: supabaseProvider,
  cloudflare: cloudflareProvider,
}

const ENV_NAME = (import.meta.env.VITE_VIDEO_PROVIDER ?? 'supabase') as VideoProviderName
const DEFAULT_NAME: VideoProviderName = ENV_NAME in PROVIDERS ? ENV_NAME : 'supabase'

export function getDefaultProvider(): VideoProvider {
  return PROVIDERS[DEFAULT_NAME]
}

export function getProvider(name: VideoProviderName): VideoProvider {
  return PROVIDERS[name]
}

export * from './types'
