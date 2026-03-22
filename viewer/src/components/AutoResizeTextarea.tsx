import { useRef, useEffect } from 'react'

interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number
}

const LINE_HEIGHT = 20 // approximate line height for text-xs

export function AutoResizeTextarea({ value, minRows = 1, className = '', ...props }: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset height to get accurate scrollHeight, then set to content height
    el.style.height = '0'
    el.style.height = `${Math.max(el.scrollHeight, minRows * LINE_HEIGHT)}px`
  }, [value, minRows])

  return (
    <textarea
      ref={ref}
      value={value}
      className={className}
      {...props}
    />
  )
}
