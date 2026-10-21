import type { ReactNode } from 'react'
import { OpenAI } from '@lobehub/icons'
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { isWindows } from '../lib/platform'
import { useRightPanel } from '../lib/right-panel-store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { TabsList, TabsTrigger } from './ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { WindowControls } from './WindowControls'

interface TopStatusBarProps {
  settingsOpen: boolean
  sidebarWidth: number
  onBack(): void
  children?: ReactNode
}

export function TopStatusBar({ settingsOpen, sidebarWidth, onBack, children }: TopStatusBarProps) {
  const rightPanelOpen = useRightPanel((state) => state.open)
  const rightPanelWidth = useRightPanel((state) => state.width)
  const rightPanelLabel = rightPanelOpen ? '收起右侧面板' : '展开右侧面板'
  const isRightPanelVisible = rightPanelOpen && !settingsOpen

  return (
    <header
      className="app-top-status-bar title-bar flex h-[var(--app-titlebar-height)] shrink-0 items-center"
      data-right-panel-open={isRightPanelVisible}
      aria-label="顶部状态栏"
    >
      <div
        className="top-status-bar-leading flex h-full shrink-0 items-center"
        style={{ width: `calc(var(--app-navigation-width) + ${sidebarWidth}px + 1px)` }}
      >
        {isWindows && (
          <div
            className="top-status-bar-logo flex h-full w-[var(--app-navigation-width)] shrink-0 items-center justify-center"
            role="img"
            aria-label="OpenAI Logo（临时占位）"
          >
            <OpenAI className="top-status-bar-logo-icon" size={20} aria-hidden="true" />
          </div>
        )}
        <nav
          aria-label="历史导航"
          className="top-status-bar-history flex h-full flex-1 items-center gap-1"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="navigation"
                  size="icon"
                  className="history-back-button"
                  aria-label="后退"
                  disabled={!settingsOpen}
                  onClick={onBack}
                />
              }
            >
              <ArrowLeft className="history-back-icon" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {settingsOpen ? '后退到工作区' : '后退（功能待接入）'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="navigation"
                  size="icon"
                  className="history-forward-button"
                  aria-label="前进"
                  disabled
                />
              }
            >
              <ArrowRight className="history-forward-icon" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="bottom">前进（功能待接入）</TooltipContent>
          </Tooltip>
        </nav>
      </div>
      <div className="top-status-bar-content flex h-full min-w-0 flex-1 items-center">
        {children}
      </div>
      <div
        className={cn(
          'right-panel-header flex h-full shrink-0 items-center',
          rightPanelOpen ? 'justify-between' : 'justify-end',
          settingsOpen && 'hidden',
        )}
        data-open={isRightPanelVisible}
        // +1px 对齐下方渲染在面板外侧的 1px ResizableHandle 分割线。
        style={isRightPanelVisible ? { width: rightPanelWidth + 1 } : undefined}
      >
        {rightPanelOpen ? (
          <>
            <div className="right-panel-header-leading flex h-full items-center gap-2">
              <Separator
                aria-hidden="true"
                orientation="vertical"
                className="right-panel-tabs-separator bg-titlebar-separator data-vertical:h-4 data-vertical:self-center"
              />
              <TabsList
                className="right-panel-tool-tabs h-8 gap-1 bg-transparent p-0"
                aria-label="右侧面板功能"
              >
                <TabsTrigger
                  value="files"
                  className="right-panel-files-tab h-8 w-8 flex-none rounded-md bg-terminal-tab-inactive p-0 text-muted-foreground transition-colors [&:not([data-active])]:hover:bg-terminal-tab-inactive-hover [&:not([data-active])]:hover:text-foreground data-active:bg-card data-active:hover:bg-card data-active:text-foreground data-active:hover:text-foreground data-active:shadow-xs data-active:cursor-default"
                  aria-label="文件浏览"
                  title="文件浏览"
                >
                  <Folder className="right-panel-files-tab-icon" />
                </TabsTrigger>
                <TabsTrigger
                  value="git"
                  className="right-panel-git-tab h-8 w-8 flex-none rounded-md bg-terminal-tab-inactive p-0 text-muted-foreground transition-colors [&:not([data-active])]:hover:bg-terminal-tab-inactive-hover [&:not([data-active])]:hover:text-foreground data-active:bg-card data-active:hover:bg-card data-active:text-foreground data-active:hover:text-foreground data-active:shadow-xs data-active:cursor-default"
                  aria-label="Git 管理"
                  title="Git 管理"
                >
                  <GitBranch className="right-panel-git-tab-icon" />
                </TabsTrigger>
              </TabsList>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="navigation"
                    size="icon"
                    id="right-panel-toggle"
                    className="right-panel-toggle shrink-0"
                    aria-label={rightPanelLabel}
                    aria-expanded={rightPanelOpen}
                    aria-controls="right-panel-content"
                    onClick={() => useRightPanel.setState({ open: !rightPanelOpen })}
                  />
                }
              >
                <PanelRightClose className="right-panel-toggle-icon" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{rightPanelLabel}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="navigation"
                  size="icon"
                  id="right-panel-toggle"
                  className="right-panel-toggle shrink-0"
                  aria-label={rightPanelLabel}
                  aria-expanded={rightPanelOpen}
                  aria-controls="right-panel-content"
                  onClick={() => useRightPanel.setState({ open: !rightPanelOpen })}
                />
              }
            >
              <PanelRightOpen className="right-panel-toggle-icon" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{rightPanelLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* Electron drag-region hit testing follows DOM order; window buttons render last. */}
      {isWindows && <WindowControls />}
    </header>
  )
}
