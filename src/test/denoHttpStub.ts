// Stub for Deno HTTP server when imported in Node/Vitest test environment
export function serve(_handler: (req: Request) => Promise<Response> | Response): void {
  // No-op stub for Vite/Vitest test environment
}

if (typeof (globalThis as Record<string, unknown>).Deno === 'undefined') {
  (globalThis as Record<string, unknown>).Deno = {
    env: {
      get: (_key: string) => undefined,
      set: (_key: string, _val: string) => {},
    },
    readTextFile: async (_path: string) => '',
  }
}
