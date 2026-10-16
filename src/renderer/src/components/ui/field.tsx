import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn('field-group flex w-full flex-col gap-4', className)}
      {...props}
    />
  )
}

function Field({ className, ...props }: ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field"
      className={cn(
        'field flex w-full min-w-0 flex-col gap-2 data-[invalid=true]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

function FieldLabel({ className, htmlFor, ...props }: ComponentProps<'label'>) {
  return (
    <label
      htmlFor={htmlFor}
      data-slot="field-label"
      className={cn(
        'field-label flex w-fit items-center gap-2 leading-snug font-medium',
        className,
      )}
      {...props}
    />
  )
}

export { FieldGroup, Field, FieldLabel }
