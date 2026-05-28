import { useRef } from 'react'
import { Calendar } from 'lucide-react'

interface Props {
  id?: string
  'data-testid'?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  title?: string
}

export default function DateTimeInput({
  id,
  'data-testid': testId,
  value,
  onChange,
  disabled,
  title,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        id={id}
        data-testid={testId}
        type="datetime-local"
        className="input w-full"
        style={{ paddingRight: 40 }}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        title={title}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => inputRef.current?.showPicker?.()}
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          padding: 0,
          lineHeight: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: 'var(--ink-3)',
        }}
        aria-hidden
      >
        <Calendar size={16} />
      </button>
    </div>
  )
}
