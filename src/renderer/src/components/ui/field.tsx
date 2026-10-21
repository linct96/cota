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

function FieldDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('field-description text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: ComponentProps<'div'> & { errors?: Array<{ message?: string } | undefined> }) {
  const messages = [...new Set(errors?.map((error) => error?.message).filter(Boolean))]
  if (!children && !messages.length) return null
  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('field-error text-xs text-destructive', className)}
      {...props}
    >
      {children || messages.join(' ')}
    </div>
  )
}

export { FieldGroup, Field, FieldLabel, FieldDescription, FieldError }
