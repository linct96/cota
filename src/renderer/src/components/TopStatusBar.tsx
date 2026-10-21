import type { ReactNode } from 'react'
import { OpenAI } from '@lobehub/icons'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { isWindows } from '../lib/platform'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { WindowControls } from './WindowControls'

interface TopStatusBarProps {
  settingsOpen: boolean
  onBack(): void
  children?: ReactNode
}

export function TopStatusBar({ settingsOpen, onBack, children }: TopStatusBarProps) {
  return (
    <header
      className="app-top-status-bar title-bar flex h-[var(--app-titlebar-height)] shrink-0 items-center"
      aria-label="顶部状态栏"
    >
      <div className="top-status-bar-leading flex h-full w-[calc(var(--app-navigation-width)+15rem)] shrink-0 items-center">
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
      {/* Electron drag-region hit testing follows DOM order; window buttons render last. */}
      {isWindows && <WindowControls />}
    </header>
  )
}
