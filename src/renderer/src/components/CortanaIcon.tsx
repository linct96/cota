import type { SVGProps } from 'react'
import { cn } from 'cn'

export function CortanaIcon({
  active = false,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { active?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('cortana-icon', className)}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={active ? 1.9 : 1.6}
        strokeLinecap="round"
        strokeDasharray="21 7.27"
        transform="rotate(-35 12 12)"
        className="cortana-icon-outer-ring"
      />
      <circle
        cx="12"
        cy="12"
        r="5.25"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.75}
        className="cortana-icon-inner-halo"
      />
      <circle
        cx="12"
        cy="12"
        r={active ? 1.85 : 1.25}
        fill="currentColor"
        className="cortana-icon-core"
      />
    </svg>
  )
}
