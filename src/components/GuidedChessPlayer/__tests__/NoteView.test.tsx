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
})
