import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

vi.mock('./lib/coursesApi', () => ({
  listPublishedCourses: vi.fn().mockResolvedValue({ courses: [], error: null }),
}))

vi.mock('./lib/campaignsApi', () => ({
  getCurrentActiveCampaign: vi.fn().mockResolvedValue({ campaign: null, error: null }),
  campaignAppliesToCourse: vi.fn().mockReturnValue(false),
  computeCampaignDiscount: vi.fn().mockReturnValue(0),
}))

describe('App', () => {
  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    )
    expect(document.body).toBeTruthy()
  })
})
