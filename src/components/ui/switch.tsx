import * as SwitchPrimitive from '@radix-ui/react-switch'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  id?: string
  disabled?: boolean
}

export function Switch({ checked, onCheckedChange, id, disabled }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9999,
        background: checked ? 'var(--accent)' : 'var(--border)',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 150ms',
        outline: 'none',
      }}
    >
      <SwitchPrimitive.Thumb
        style={{
          display: 'block',
          width: 12,
          height: 12,
          borderRadius: 9999,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          transition: 'transform 150ms',
          transform: checked ? 'translateX(16px)' : 'translateX(3px)',
        }}
      />
    </SwitchPrimitive.Root>
  )
}
