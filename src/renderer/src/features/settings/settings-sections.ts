import { GeneralSettings } from '@/features/settings/sections/GeneralSettings'
import { NotificationSettings } from '@/features/settings/sections/NotificationSettings'
import { SourceControlSettings } from '@/features/settings/sections/SourceControlSettings'
import { CodeHostingSettings } from '@/features/settings/sections/CodeHostingSettings'
import { TerminalSettings } from '@/features/settings/sections/TerminalSettings'
import { OpenWithSettings } from '@/features/settings/sections/OpenWithSettings'
import { AppearanceSettings } from '@/features/settings/sections/AppearanceSettings'
import { FileExplorerSettings } from '@/features/settings/sections/FileExplorerSettings'
import { ShortcutSettings } from '@/features/settings/sections/ShortcutSettings'
import { AgentSettings } from '@/features/settings/sections/AgentSettings'
import { QuickCommandsSettings } from '@/features/settings/sections/QuickCommandsSettings'
import {
  AppWindow,
  Bell,
  Bot,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Keyboard,
  Play,
  Settings as SettingsIcon,
  SquareTerminal,
  Sun,
} from 'lucide-react'

interface SettingItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  keywords?: string
}

interface SettingGroup {
  id: string
  label: string
  items: SettingItem[]
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'personal',
    label: '个人',
    items: [
      {
        id: 'general',
        label: '常规',
        icon: SettingsIcon,
        keywords: '休眠 睡眠 电源 熄灭 agent prevent sleep general',
      },
      {
        id: 'notifications',
        label: '通知',
        icon: Bell,
        keywords: '启用 开关 系统 提醒 提示音 声音 静音 轮次 测试 notification sound',
      },
      {
        id: 'appearance',
        label: '外观',
        icon: Sun,
        keywords:
          '模式 主题 自动 浅色 深色 亮色 暗色 主题色 背景色 前景色 颜色 配色 theme color dark light',
      },
      {
        id: 'terminal',
        label: '终端',
        icon: SquareTerminal,
        keywords:
          'shell zsh bash fish pwsh 缓冲 行数 scrollback gpu webgl 加速 渲染 字体 字号 行高 光标 配色 主题 透明度 毛玻璃 terminal font cursor',
      },
      {
        id: 'agents',
        label: '智能体',
        icon: Bot,
        keywords: 'agent cli 安装 更新 版本 codex claude pi grok hook 钩子 状态 集成',
      },
      {
        id: 'file-explorer',
        label: '文件浏览器',
        icon: FolderTree,
        keywords: 'git 忽略 gitignore 符号链接 symlink 外观 文件夹 图标 主题 material icon theme',
      },
      {
        id: 'source-control',
        label: '源代码管理',
        icon: GitBranch,
        keywords: 'git 提交 信息 提示词 commit message prompt conventional pi 暂存',
      },
      {
        id: 'quick-commands',
        label: '快捷命令',
        icon: Play,
        keywords: '命令 脚本 服务 端口 自动端口 quick command service port',
      },
      {
        id: 'shortcuts',
        label: '键盘快捷键',
        icon: Keyboard,
        keywords: '快捷键 组合键 绑定 恢复 清除 shortcut keybinding hotkey',
      },
    ],
  },
  {
    id: 'integration',
    label: '集成',
    items: [
      {
        id: 'open-with',
        label: '打开方式',
        icon: AppWindow,
        keywords: '应用程序 默认 编辑器 启动 参数 vscode cursor zed finder explorer open with',
      },
      {
        id: 'code-hosting',
        label: '代码托管',
        icon: GitPullRequest,
        keywords: 'github gitlab gh glab host cli 全局 连接 账号 授权 登录 检测 pr mr review',
      },
    ],
  },
]

export const SETTING_COMPONENTS: Record<string, React.ComponentType> = {
  general: GeneralSettings,
  notifications: NotificationSettings,
  terminal: TerminalSettings,
  'quick-commands': QuickCommandsSettings,
  'open-with': OpenWithSettings,
  'source-control': SourceControlSettings,
  'code-hosting': CodeHostingSettings,
  appearance: AppearanceSettings,
  'file-explorer': FileExplorerSettings,
  shortcuts: ShortcutSettings,
  agents: AgentSettings,
}
