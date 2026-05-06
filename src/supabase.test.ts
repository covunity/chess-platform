import { supabase } from './lib/supabase'

describe('supabase client', () => {
  it('is initialized', () => {
    expect(supabase).toBeDefined()
  })

  it('exposes auth namespace', () => {
    expect(supabase.auth).toBeDefined()
  })
})
