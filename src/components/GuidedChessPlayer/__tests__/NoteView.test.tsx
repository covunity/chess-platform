/**
 * NoteView tests — PRD-0004 Slice 7
 * Pure component that renders RichTextDoc without TipTap.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import NoteView from '../NoteView'
import type { RichTextDoc } from '../../../utils/parsePgn'

describe('NoteView', () => {
  describe('null note', () => {
    it('renders nothing when note is null', () => {
      const { container } = render(<NoteView note={null} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('plain text paragraph', () => {
    it('renders plain text in a paragraph', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello chess world' }] },
        ],
      }
      render(<NoteView note={note} />)
      expect(screen.getByText('Hello chess world')).toBeInTheDocument()
    })

    it('renders empty paragraph without crashing', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }
      const { container } = render(<NoteView note={note} />)
      expect(container.querySelector('p')).toBeInTheDocument()
    })
  })

  describe('bold and italic marks', () => {
    it('renders bold text wrapped in <strong>', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Normal ' },
              { type: 'text', text: 'bold text', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      }
      render(<NoteView note={note} />)
      const strong = document.querySelector('strong')
      expect(strong).toBeInTheDocument()
      expect(strong?.textContent).toBe('bold text')
    })

    it('renders italic text wrapped in <em>', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'see ', marks: [] },
              { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            ],
          },
        ],
      }
      render(<NoteView note={note} />)
      const em = document.querySelector('em')
      expect(em).toBeInTheDocument()
      expect(em?.textContent).toBe('italic')
    })

    it('renders bold-italic text wrapped in both <strong> and <em>', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
            ],
          },
        ],
      }
      render(<NoteView note={note} />)
      expect(document.querySelector('strong')).toBeInTheDocument()
      expect(document.querySelector('em')).toBeInTheDocument()
    })
  })

  describe('multiple paragraphs', () => {
    it('renders multiple paragraphs', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
        ],
      }
      render(<NoteView note={note} />)
      expect(screen.getByText('First paragraph')).toBeInTheDocument()
      expect(screen.getByText('Second paragraph')).toBeInTheDocument()
      const paragraphs = document.querySelectorAll('p')
      expect(paragraphs.length).toBe(2)
    })
  })

  describe('headings', () => {
    it('renders H3 heading', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Section title' }] },
        ],
      }
      render(<NoteView note={note} />)
      const h3 = document.querySelector('h3')
      expect(h3).toBeInTheDocument()
      expect(h3?.textContent).toBe('Section title')
    })

    it('renders H4 heading', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Sub-section' }] },
        ],
      }
      render(<NoteView note={note} />)
      expect(document.querySelector('h4')).toBeInTheDocument()
    })
  })

  describe('lists', () => {
    it('renders a bullet list as <ul>', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item one' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item two' }] }] },
            ],
          },
        ],
      }
      render(<NoteView note={note} />)
      expect(document.querySelector('ul')).toBeInTheDocument()
      expect(document.querySelectorAll('li').length).toBe(2)
      expect(screen.getByText('Item one')).toBeInTheDocument()
      expect(screen.getByText('Item two')).toBeInTheDocument()
    })

    it('renders an ordered list as <ol>', () => {
      const note: RichTextDoc = {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
            ],
          },
        ],
      }
      render(<NoteView note={note} />)
      expect(document.querySelector('ol')).toBeInTheDocument()
      expect(document.querySelectorAll('li').length).toBe(2)
    })
  })
})
