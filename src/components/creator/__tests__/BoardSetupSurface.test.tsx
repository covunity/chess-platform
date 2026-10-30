import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BoardSetupSurface, { validateBoardPieces } from '../BoardSetupSurface'

describe('BoardSetupSurface', () => {
  it('renders 64 squares, piece palette, and clear board button', () => {
    const onChange = vi.fn()
    render(<BoardSetupSurface onChange={onChange} />)

    expect(screen.getByTestId('clear-board-btn')).toBeInTheDocument()
    expect(screen.getByTestId('standard-board-btn')).toBeInTheDocument()
    expect(screen.getByText('Khay quân cờ')).toBeInTheDocument()
    expect(screen.getByTestId('board-square-e4')).toBeInTheDocument()
    expect(screen.getByTestId('board-square-e8')).toBeInTheDocument()
  })

  it('clears board when clicking Bàn cờ trống', () => {
    const onChange = vi.fn()
    render(<BoardSetupSurface onChange={onChange} />)

    fireEvent.click(screen.getByTestId('clear-board-btn'))

    expect(onChange).toHaveBeenCalledWith(
      '8/8/8/8/8/8/8/8 w - - 0 1',
      'white',
      false // invalid because 0 kings
    )
  })

  it('places a piece on square when selected from palette', () => {
    const onChange = vi.fn()
    render(<BoardSetupSurface onChange={onChange} />)

    // Select White Queen from palette
    const whiteQueenBtn = screen.getByTitle('Quân Trắng Q')
    fireEvent.click(whiteQueenBtn)

    // Click on square e4
    fireEvent.click(screen.getByTestId('board-square-e4'))

    // Square e4 should now contain a piece
    expect(screen.getByTestId('board-square-e4').querySelector('piece')).toBeInTheDocument()
  })

  describe('validateBoardPieces', () => {
    it('requires exactly 1 white king and 1 black king', () => {
      const emptyBoard = new Map()
      const valEmpty = validateBoardPieces(emptyBoard)
      expect(valEmpty.isValid).toBe(false)
      expect(valEmpty.error).toMatch(/Hãy đặt Vua Trắng và Vua Đen/i)

      const oneKingBoard = new Map([['e1', { type: 'k' as const, side: 'w' as const }]])
      const valOne = validateBoardPieces(oneKingBoard)
      expect(valOne.isValid).toBe(false)
      expect(valOne.error).toMatch(/Thiếu Vua Đen/i)

      const validBoard = new Map([
        ['e1', { type: 'k' as const, side: 'w' as const }],
        ['e8', { type: 'k' as const, side: 'b' as const }],
      ])
      const valValid = validateBoardPieces(validBoard)
      expect(valValid.isValid).toBe(true)
      expect(valValid.error).toBeNull()
    })
  })
})

