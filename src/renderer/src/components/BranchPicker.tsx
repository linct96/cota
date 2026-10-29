import { useId, useState, type ReactNode } from 'react'
import type { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Check, GitBranch, ListFilter } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Separator } from './ui/separator'

interface BranchOption {
  value: string
  label: string
  date?: string
}

export function BranchPicker<T extends BranchOption>({
  items,
  value,
  label,
  placeholder = '选择分支',
  variant = 'default',
  defaultShowLocal = true,
  filterOptions = {},
  className,
  triggerProps,
  renderItem,
  search,
  children,
  isItemEqualToValue = (a, b) => a.value === b.value,
  ...props
}: Omit<ComboboxPrimitive.Root.Props<T>, 'items' | 'children' | 'multiple'> & {
  items: { label: string; type: 'local' | 'remote'; items: T[] }[]
  label?: string
  placeholder?: string
  variant?: 'default' | 'ghost'
  defaultShowLocal?: boolean
  filterOptions?: {
    branchType?: boolean
    sortByDate?: boolean
  }
  className?: string
  triggerProps?: Omit<ComboboxPrimitive.Trigger.Props, 'children' | 'render' | 'className'>
  renderItem?: (branch: T) => ReactNode
  search?: (filters: ReactNode) => ReactNode
  children?: ReactNode
}) {
  const [showLocal, setShowLocal] = useState(defaultShowLocal)
  const [showRemote, setShowRemote] = useState(true)
  const [sort, setSort] = useState('date')
  const hasLocal = items.some((group) => group.type === 'local')
  const hasRemote = items.some((group) => group.type === 'remote')
  const { branchType = true, sortByDate = true } = filterOptions
  const allHaveDates =
    items.some((group) => group.items.length > 0) &&
    items.every((group) =>
      group.items.every((branch) => Number.isFinite(Date.parse(branch.date ?? ''))),
    )
  const groups = items
    .filter((group) => !branchType || (group.type === 'local' ? showLocal : showRemote))
    .map((group) => ({
      ...group,
      items:
        sortByDate && sort === 'date' && allHaveDates
          ? [...group.items].sort((a, b) => Date.parse(b.date ?? '') - Date.parse(a.date ?? ''))
          : group.items,
    }))
    .filter((group) => group.items.length > 0)
  const disabled = props.disabled || triggerProps?.disabled
  const filters = (branchType || sortByDate) && (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="branch-picker-filter-trigger"
        render={<Button type="button" variant="ghost" size="icon" />}
        aria-label="筛选与排序分支"
        title="筛选与排序分支"
        disabled={disabled}
      >
        <ListFilter className="branch-picker-filter-icon" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="branch-picker-filter-menu" align="end">
        {branchType && (
          <DropdownMenuGroup className="branch-picker-type-options">
            <DropdownMenuLabel className="branch-picker-type-label">分支类型</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              className="branch-picker-filter-local"
              checked={hasLocal && showLocal}
              onCheckedChange={setShowLocal}
              disabled={!hasLocal}
            >
              本地
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              className="branch-picker-filter-remote"
              checked={hasRemote && showRemote}
              onCheckedChange={setShowRemote}
              disabled={!hasRemote}
            >
              远端
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        )}
        {branchType && sortByDate && (
          <DropdownMenuSeparator className="branch-picker-filter-separator" />
        )}
        {sortByDate && (
          <DropdownMenuRadioGroup
            className="branch-picker-sort-options"
            value={allHaveDates ? sort : 'default'}
            onValueChange={setSort}
          >
            <DropdownMenuLabel className="branch-picker-sort-label">排序</DropdownMenuLabel>
            <DropdownMenuRadioItem className="branch-picker-sort-default" value="default">
              默认排序
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              className="branch-picker-sort-date"
              value="date"
              disabled={!allHaveDates}
              title={!allHaveDates ? '所有分支均需提供有效的提交时间' : undefined}
            >
              按时间倒序
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const displayLabel = label ?? value?.label ?? placeholder
  return (
    <Combobox<T>
      items={groups}
      value={value}
      itemToStringLabel={(branch) => branch.label}
      itemToStringValue={(branch) => branch.value}
      isItemEqualToValue={isItemEqualToValue}
      {...props}
    >
      <ComboboxTrigger
        className={cn(
          'branch-picker-trigger min-w-0 justify-start gap-1',
          variant === 'ghost' ? 'w-auto' : 'w-full',
          className,
        )}
        render={
          <Button type="button" variant={variant === 'ghost' ? 'ghost' : 'outline'} size="sm" />
        }
        aria-label={placeholder}
        title={displayLabel}
        {...triggerProps}
      >
        <GitBranch
          className="branch-picker-trigger-icon shrink-0"
          data-icon="inline-start"
          aria-hidden="true"
        />
        <span className="branch-picker-trigger-label min-w-0 flex-1 truncate text-left">
          {displayLabel}
        </span>
      </ComboboxTrigger>
      <ComboboxContent
        className="branch-picker-content flex min-w-(--anchor-width) flex-col"
        onKeyDown={(event) => {
          // Search Enter selects a branch, never submits the surrounding form.
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <ComboboxEmpty className="branch-picker-empty shrink-0">未找到匹配的分支</ComboboxEmpty>
        <ComboboxList className="branch-picker-list min-h-0">
          {(group: (typeof groups)[number]) => (
            <ComboboxGroup key={group.label} items={group.items} className="branch-picker-group">
              <ComboboxLabel className="branch-picker-group-label">{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(branch: T) => {
                  if (renderItem) return renderItem(branch)
                  const BranchIcon = value && isItemEqualToValue(branch, value) ? Check : GitBranch
                  return (
                    <ComboboxItem
                      key={branch.value}
                      value={branch}
                      showIndicator={false}
                      className="branch-picker-option"
                      title={branch.label}
                    >
                      <BranchIcon className="branch-picker-option-icon" aria-hidden="true" />
                      <span className="branch-picker-option-label min-w-0 truncate">
                        {branch.label}
                      </span>
                    </ComboboxItem>
                  )
                }}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        {children}
        <Separator className="branch-picker-search-separator group-data-[side=bottom]/combobox-content:-order-1" />
        {search ? (
          search(filters)
        ) : (
          <BranchPickerSearch inputProps={{ disabled }} actions={filters} />
        )}
      </ComboboxContent>
    </Combobox>
  )
}

export function BranchPickerSearch({
  inputProps,
  actions,
  error,
}: {
  inputProps?: ComboboxPrimitive.Input.Props
  actions?: ReactNode
  error?: ReactNode
}) {
  const generatedId = useId()
  const id = inputProps?.id ?? generatedId
  return (
    <FieldGroup className="branch-picker-search shrink-0 p-1 group-data-[side=bottom]/combobox-content:order-first">
      <Field className="branch-picker-search-field" data-invalid={inputProps?.['aria-invalid']}>
        <FieldLabel className="branch-picker-search-label sr-only" htmlFor={id}>
          {inputProps?.placeholder ?? '搜索分支…'}
        </FieldLabel>
        <div className="branch-picker-search-controls flex items-center gap-1">
          <ComboboxInput
            className="branch-picker-search-input min-w-0 flex-1"
            placeholder="搜索分支…"
            {...inputProps}
            id={id}
          />
          {actions}
        </div>
        {error}
      </Field>
    </FieldGroup>
  )
}
