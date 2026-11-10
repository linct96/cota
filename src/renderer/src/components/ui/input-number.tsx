import { useRef } from 'react'
import type { ComponentProps } from 'react'
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InputGroup, InputGroupAddon, InputGroupInput } from './input-group'

const defaultFormat: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 20 }
const stepperClassName =
  'ui-input-number-stepper flex min-h-0 w-full items-center justify-center text-muted-foreground transition-colors outline-none hover:not-disabled:bg-accent hover:not-disabled:text-foreground active:not-disabled:bg-accent-hover focus-visible:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-40 [&>svg]:size-3'

type InputNumberProps = Omit<
  ComponentProps<typeof NumberFieldPrimitive.Root>,
  'className' | 'children' | 'render' | 'onValueChange'
> & {
  className?: string
  onValueChange?: (value: number | null) => void
  inputProps?: Omit<
    ComponentProps<typeof NumberFieldPrimitive.Input>,
    'value' | 'defaultValue' | 'onChange' | 'children' | 'render'
  >
}

function InputNumber({
  className,
  inputProps,
  onValueChange,
  step = 1,
  smallStep = step === 'any' ? 1 : step,
  largeStep = smallStep * 10,
  format = defaultFormat,
  allowOutOfRange = true,
  allowWheelScrub = false,
  ...props
}: InputNumberProps) {
  const handledInputChange = useRef(false)
  const wasInputChangeHandled = () => handledInputChange.current

  return (
    <NumberFieldPrimitive.Root
      data-slot="input-number"
      className={cn('ui-input-number w-full min-w-0 tabular-nums', className)}
      step={step}
      smallStep={smallStep}
      largeStep={largeStep}
      format={format}
      allowOutOfRange={allowOutOfRange}
      allowWheelScrub={allowWheelScrub}
      onValueChange={(value) => {
        handledInputChange.current = true
        onValueChange?.(value)
      }}
      {...props}
    >
      <NumberFieldPrimitive.Group
        render={<InputGroup />}
        className="ui-input-number-group overflow-hidden data-disabled:opacity-50"
      >
        <NumberFieldPrimitive.Input
          render={(inputAttributes) => (
            <InputGroupInput
              {...inputAttributes}
              onChange={(event) => {
                handledInputChange.current = false
                inputAttributes.onChange?.(event)
                // Base UI keeps the last number for partial text; forms must not submit it.
                if (
                  !wasInputChangeHandled() &&
                  !event.defaultPrevented &&
                  !event.nativeEvent.defaultPrevented
                )
                  onValueChange?.(null)
              }}
            />
          )}
          aria-roledescription="数字输入"
          {...inputProps}
        />
        <InputGroupAddon
          align="inline-end"
          className="ui-input-number-steppers grid h-full w-6 shrink-0 grid-rows-2 gap-0 self-stretch border-s border-input p-0 has-[>button]:mr-0"
        >
          <NumberFieldPrimitive.Increment className={stepperClassName} aria-label="增加">
            <ChevronUpIcon className="ui-input-number-increase-icon" aria-hidden="true" />
          </NumberFieldPrimitive.Increment>
          <NumberFieldPrimitive.Decrement
            className={cn(stepperClassName, 'border-t border-input')}
            aria-label="减少"
          >
            <ChevronDownIcon className="ui-input-number-decrease-icon" aria-hidden="true" />
          </NumberFieldPrimitive.Decrement>
        </InputGroupAddon>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  )
}

export { InputNumber, type InputNumberProps }
