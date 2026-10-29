import { useState, type ComponentProps } from 'react'
import { cn } from 'cn'
import { InputGroup, InputGroupAddon, InputGroupInput } from './input-group'

type ColorInputProps = Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange'
> & {
  value: string
  onValueChange: (value: string) => void
  fallbackColor?: string
  pickerLabel: string
}

const hexColorPattern = /^#[\da-f]{6}$/i

function ColorInput({
  value,
  onValueChange,
  fallbackColor = '#000000',
  pickerLabel,
  className,
  disabled,
  readOnly,
  onBlur,
  ...props
}: ColorInputProps) {
  const fallback = hexColorPattern.test(fallbackColor) ? fallbackColor : '#000000'
  const color = hexColorPattern.test(value) ? value : value === '' ? fallback : undefined
  const [previewColor, setPreviewColor] = useState(color ?? fallback)
  if (color && color !== previewColor) setPreviewColor(color)

  return (
    <InputGroup
      className={cn('color-input h-7 w-auto shrink-0', className)}
      data-disabled={disabled}
    >
      <InputGroupInput
        {...props}
        type="text"
        className="color-input-text w-[calc(7ch+1rem)] flex-none font-mono"
        value={value}
        maxLength={7}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        disabled={disabled}
        readOnly={readOnly}
        onBlur={onBlur}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <InputGroupAddon className="color-input-addon py-0 pl-1.5">
        <input
          type="color"
          data-slot="input-group-control"
          className="color-input-picker size-5 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-sm border-0 bg-transparent p-0 outline-none disabled:cursor-not-allowed [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-xs [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-input [&::-moz-color-swatch]:rounded-xs [&::-moz-color-swatch]:border [&::-moz-color-swatch]:border-input"
          value={previewColor}
          disabled={disabled || readOnly}
          aria-label={pickerLabel}
          aria-invalid={props['aria-invalid']}
          aria-describedby={props['aria-describedby']}
          onBlur={onBlur}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </InputGroupAddon>
    </InputGroup>
  )
}

export { ColorInput, type ColorInputProps }
