import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TerminalSettingRowProps {
  className?: string
  textClassName?: string
  labelId: string
  label: ReactNode
  labelClassName?: string
  descriptionId?: string
  description?: ReactNode
  descriptionClassName?: string
  error?: ReactNode
  invalid?: boolean
  children: ReactNode
}

/** 终端设置页统一标准行布局，保持与常规及通知设置页面一致的左文右控 DOM 结构。 */
export function TerminalSettingRow({
  className,
  textClassName,
  labelId,
  label,
  labelClassName,
  descriptionId,
  description,
  descriptionClassName,
  error,
  invalid,
  children,
}: TerminalSettingRowProps) {
  return (
    <div
      className={cn(
        'flex min-h-7 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 data-[invalid=true]:text-destructive',
        className,
      )}
      data-invalid={invalid}
    >
      <div className={cn('flex min-w-0 max-w-3/5 flex-1 basis-64 flex-col gap-0.5', textClassName)}>
        <span
          id={labelId}
          className={cn('text-xs leading-5 font-medium text-foreground', labelClassName)}
        >
          {label}
        </span>
        {description && (
          <p
            id={descriptionId}
            className={cn('text-xs text-muted-foreground', descriptionClassName)}
          >
            {description}
          </p>
        )}
        {error}
      </div>
      {children}
    </div>
  )
}
