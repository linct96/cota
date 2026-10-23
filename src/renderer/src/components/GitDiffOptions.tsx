import { Ellipsis } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export type DiffDisplayOptions = {
  sideBySide: boolean
  wordWrap: boolean
  showWhitespace: boolean
}

export const DEFAULT_DIFF_DISPLAY_OPTIONS: DiffDisplayOptions = {
  sideBySide: false,
  wordWrap: false,
  showWhitespace: false,
}

export function GitDiffOptions({
  value,
  onChange,
  disabled = false,
}: {
  value: DiffDisplayOptions
  onChange: (value: DiffDisplayOptions) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="source-control-diff-more-trigger"
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label="更多 Diff 显示选项"
        title="更多显示选项"
        disabled={disabled}
      >
        <Ellipsis className="source-control-diff-more-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="source-control-diff-more-menu" align="end">
        <DropdownMenuGroup className="source-control-diff-display-options">
          <DropdownMenuCheckboxItem
            className="source-control-diff-split"
            checked={value.sideBySide}
            onCheckedChange={(sideBySide) => onChange({ ...value, sideBySide })}
            closeOnClick
          >
            并排显示
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            className="source-control-diff-word-wrap"
            checked={value.wordWrap}
            onCheckedChange={(wordWrap) => onChange({ ...value, wordWrap })}
            closeOnClick
          >
            自动换行
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            className="source-control-diff-show-whitespace"
            checked={value.showWhitespace}
            onCheckedChange={(showWhitespace) => onChange({ ...value, showWhitespace })}
            closeOnClick
          >
            显示空白
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
