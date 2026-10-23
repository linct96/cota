import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { inspectAgentHook } from './managed-hooks'
import { isWindows } from '../system/platform'

export const codexShellFunction = `
if ! alias codex >/dev/null 2>&1 && ! typeset -f codex >/dev/null 2>&1; then
  function codex {
    local __cota_arg __cota_isolate=1 __cota_program=codex
    for __cota_arg in "$@"; do
      case "$__cota_arg" in agents|queue|--no-daemon|--remote|--remote=*) __cota_isolate=0 ;; esac
    done
    if [[ "$__cota_isolate" = 1 ]]; then
      case "$(command "$__cota_program" --help 2>/dev/null </dev/null)" in
        *--no-daemon*) set -- --no-daemon "$@" ;;
      esac
    fi
    command "$__cota_program" "$@"
  }
fi
`

const fishCodexShellFunction = `
set -l __cota_codex_type (type -t codex 2>/dev/null)
if test "$__cota_codex_type" = file
  function codex
    set -l __cota_isolate 1
    for __cota_arg in $argv
      switch "$__cota_arg"
        case agents queue --no-daemon --remote '--remote=*'
          set __cota_isolate 0
      end
    end
    if test "$__cota_isolate" = 1; and command codex --help 2>/dev/null </dev/null | string match -q -- '*--no-daemon*'
      set argv --no-daemon $argv
    end
    command codex $argv
  end
end
set -e __cota_codex_type
`

const shellStartupCommand = `
if [[ -n "\${COTA_STARTUP_COMMAND-}" ]]; then
  __cota_startup_command="$COTA_STARTUP_COMMAND"
  unset COTA_STARTUP_COMMAND
  printf '%s\\n' "$__cota_startup_command"
  eval "$__cota_startup_command"
  unset __cota_startup_command
fi
`

const fishStartupCommand = `
if set -q COTA_STARTUP_COMMAND
  set -l __cota_startup_command "$COTA_STARTUP_COMMAND"
  set -e COTA_STARTUP_COMMAND
  printf '%s\\n' "$__cota_startup_command"
  eval "$__cota_startup_command"
end
`

const powershellStartupCommand = `
$cotaStartupCommand = $env:COTA_STARTUP_COMMAND
Remove-Item Env:COTA_STARTUP_COMMAND
Write-Host $cotaStartupCommand
Invoke-Expression $cotaStartupCommand
Remove-Variable cotaStartupCommand -ErrorAction SilentlyContinue
`

const preparations = new Map<string, Promise<void>>()
// Only Cota's private runtime files are written here, never the user's shell or CLI configuration.
export async function prepareAgentShell(
  shell: string,
  env: Record<string, string>,
  runtime: string,
  startupCommand?: string,
): Promise<string[] | undefined> {
  const name = basename(shell)
  const codex = (await inspectAgentHook('codex', env)).state === 'installed'
  if (startupCommand !== undefined) env.COTA_STARTUP_COMMAND = startupCommand
  if (isWindows) {
    if (!/^(?:pwsh|powershell)\.exe$/i.test(name)) {
      if (startupCommand !== undefined)
        throw new Error('快捷命令需要使用 PowerShell、Bash、Zsh 或 Fish。')
      return
    }
    if (!codex && startupCommand === undefined) return
    const codexFunction = `
$cotaCommand = Get-Command codex -ErrorAction SilentlyContinue
if ($cotaCommand -and $cotaCommand.CommandType -eq 'Application') {
  function global:codex {
    $cotaApplication = Get-Command codex -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $cotaArguments = @($args)
    if (-not ($cotaArguments | Where-Object { $_ -in @('agents', 'queue', '--no-daemon', '--remote') -or $_ -like '--remote=*' })) {
      $cotaHelp = & $cotaApplication.Source --help 2>$null | Out-String
      if ($cotaHelp.Contains('--no-daemon')) { $cotaArguments = @('--no-daemon') + $cotaArguments }
    }
    & $cotaApplication.Source @cotaArguments
  }
}
Remove-Variable cotaCommand -ErrorAction SilentlyContinue
`
    const script =
      (codex ? codexFunction : '') + (startupCommand === undefined ? '' : powershellStartupCommand)
    return [
      '-NoLogo',
      '-NoExit',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ]
  }
  if (!['zsh', 'bash', 'fish'].includes(name)) {
    if (startupCommand !== undefined)
      throw new Error('快捷命令需要使用 PowerShell、Bash、Zsh 或 Fish。')
    return
  }
  if (!codex && startupCommand === undefined) return
  // Native startup scripts run commands after user initialization, without racing PTY input.
  const startup = startupCommand === undefined ? '' : shellStartupCommand
  if (name === 'fish')
    return [
      '-il',
      '-C',
      (codex ? fishCodexShellFunction : '') +
        (startupCommand === undefined ? '' : fishStartupCommand),
    ]

  const directory = join(
    runtime,
    `shell-${name}${startupCommand === undefined ? '' : codex ? '-command-codex' : '-command'}`,
  )
  let preparation = preparations.get(directory)
  if (!preparation) {
    preparation = (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (name === 'bash') {
        await writeFile(
          join(directory, 'rcfile'),
          `
# --rcfile replaces login startup; preserve its profile order without sourcing .bashrc twice.
if [[ -r /etc/profile ]]; then source /etc/profile; fi
for __cota_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [[ -r "$__cota_profile" ]]; then
    source "$__cota_profile"
    break
  fi
done
unset __cota_profile
${codex ? codexShellFunction : ''}
${startup}`,
          { mode: 0o600 },
        )
        return
      }
      for (const file of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
        const source = `export ZDOTDIR="$COTA_SHELL_SOURCE"
if [[ -r "$COTA_SHELL_SOURCE/${file}" ]]; then
  source "$COTA_SHELL_SOURCE/${file}"
fi
export COTA_SHELL_SOURCE="\${ZDOTDIR:-$HOME}"
export ZDOTDIR="$COTA_SHELL_WRAPPER"
${codex && (file === '.zshrc' || file === '.zlogin') ? codexShellFunction : ''}
${file === '.zlogin' ? 'export ZDOTDIR="$COTA_SHELL_SOURCE"\n' + startup : ''}`
        await writeFile(join(directory, file), source, { mode: 0o600 })
      }
    })().catch((error) => {
      preparations.delete(directory)
      throw error
    })
    preparations.set(directory, preparation)
  }
  await preparation
  if (name === 'bash') return ['--rcfile', join(directory, 'rcfile'), '-i']
  env.COTA_SHELL_SOURCE = env.ZDOTDIR || env.HOME || homedir()
  env.COTA_SHELL_WRAPPER = directory
  env.ZDOTDIR = directory
  return ['-il']
}
