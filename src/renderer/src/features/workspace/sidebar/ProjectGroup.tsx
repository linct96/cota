import type { ReactNode } from 'react'
import { ChevronRight, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { ProjectGroup as ProjectGroupData } from '../../../../../shared/project-groups'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function ProjectGroup({
  group,
  disabled,
  onCollapsedChange,
  onAdd,
  onRename,
  onRemove,
  rememberTrigger,
  children,
}: {
  group: ProjectGroupData
  disabled: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onAdd: () => void
  onRename: () => void
  onRemove: () => void
  rememberTrigger: (trigger: HTMLElement) => void
  children: ReactNode
}) {
  return (
    <Collapsible
      render={<section />}
      className="project-group flex min-w-0 shrink-0 flex-col gap-1"
      aria-label={`${group.name}分组`}
      open={!group.collapsed}
      onOpenChange={(open) => onCollapsedChange(!open)}
    >
      <div className="project-group-row group/project-group flex items-center pr-1 transition-colors">
        <h3 className="project-group-heading min-w-0 flex-1">
          <CollapsibleTrigger
            render={<Button variant="project" />}
            className="project-group-trigger w-full min-w-0 justify-start gap-2 px-2 bg-transparent text-inherit hover:bg-transparent hover:text-inherit"
            disabled={disabled}
            title={group.name}
          >
            <ChevronRight
              className={cn(
                'project-group-chevron size-3.5 transition-transform duration-150',
                !group.collapsed && 'rotate-90',
              )}
              aria-hidden="true"
            />
            <span className="project-group-name truncate">{group.name}</span>
          </CollapsibleTrigger>
        </h3>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="project" size="icon-sm" />}
            className="project-group-add-button invisible shrink-0 bg-transparent text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent focus-visible:visible group-hover/project-group:visible group-has-data-popup-open/project-group:visible"
            aria-label={`${group.name} 添加项目`}
            disabled={disabled}
            onClick={onAdd}
          >
            <FolderPlus className="project-group-add-icon" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="project-group-add-tooltip">
            添加项目
          </TooltipContent>
        </Tooltip>
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button variant="project" size="icon-sm" />}
                  className="project-group-menu-trigger invisible shrink-0 bg-transparent text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent focus-visible:visible group-hover/project-group:visible group-has-data-popup-open/project-group:visible"
                  aria-label={`${group.name} 更多操作`}
                  disabled={disabled}
                  onFocus={(event) => rememberTrigger(event.currentTarget)}
                />
              }
            >
              <MoreHorizontal className="project-group-menu-icon size-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="project-group-menu-tooltip">
              更多操作
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="project-group-menu"
            aria-label={`${group.name} 分组操作菜单`}
          >
            <DropdownMenuGroup className="project-group-menu-actions">
              <DropdownMenuItem className="project-group-add-project" onClick={onAdd}>
                <FolderPlus className="project-group-add-project-icon" aria-hidden="true" />
                <span className="project-group-add-project-label">添加项目</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="project-group-rename" onClick={onRename}>
                <Pencil className="project-group-rename-icon" aria-hidden="true" />
                <span className="project-group-rename-label">重命名分组</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="project-group-remove"
                variant="destructive"
                onClick={onRemove}
              >
                <Trash2 className="project-group-remove-icon" aria-hidden="true" />
                <span className="project-group-remove-label">删除分组</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CollapsibleContent className="project-group-projects flex min-w-0 flex-col gap-2 pl-2 empty:hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
