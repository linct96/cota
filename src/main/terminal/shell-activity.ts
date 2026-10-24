// Session-only hooks; the root Shell PID keeps nested/remote prompt markers from clearing its job.
const posixActivity = `
__cota_activity() {
  printf '\\033]133;%s;Cota=%s;Shell=%s\\007' "$1" "$COTA_SHELL_ACTIVITY" "$$"
}
`

export const shellActivityScripts = {
  zsh: `${posixActivity}
__cota_preexec() { __cota_activity C; }
__cota_precmd() { local __cota_status=$?; __cota_activity D; return $__cota_status; }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __cota_preexec
add-zsh-hook precmd __cota_precmd
`,
  bash: `${posixActivity}
__cota_preexec() {
  if [[ "\${__cota_in_command-}" != 1 && "$BASH_COMMAND" != __cota_precmd* ]]; then
    __cota_in_command=1
    __cota_activity C
  fi
  return 0
}
__cota_precmd() {
  local __cota_status=$?
  __cota_activity D
  __cota_in_command=0
  return "$__cota_status"
}
__cota_in_command=1
if declare -F __bp_preexec_invoke_exec >/dev/null; then
  preexec_functions+=(__cota_preexec)
  precmd_functions+=(__cota_precmd)
# Do not replace custom DEBUG traps; an incompatible setup stays unknown.
elif [[ -z "$(trap -p DEBUG)" ]]; then
  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == 'declare -a '* ]]; then
    PROMPT_COMMAND+=(__cota_precmd)
  else
    PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND$'\\n'}__cota_precmd"
  fi
  trap '__cota_preexec' DEBUG
fi
`,
  fish: `
function __cota_activity
  printf '\\033]133;%s;Cota=%s;Shell=%s\\007' $argv[1] "$COTA_SHELL_ACTIVITY" $fish_pid
end
function __cota_preexec --on-event fish_preexec
  __cota_activity C
end
function __cota_precmd --on-event fish_prompt
  __cota_activity D
end
`,
  powershell: `
function global:__cota_activity($state) {
  [Console]::Write("$([char]27)]133;$state;Cota=$env:COTA_SHELL_ACTIVITY;Shell=$PID$([char]7)")
}
Import-Module PSReadLine -ErrorAction SilentlyContinue
$cotaReadLine = Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue
if ($cotaReadLine -and $cotaReadLine.ScriptBlock) {
  $global:__cota_original_readline = $cotaReadLine.ScriptBlock
  $global:__cota_original_prompt = (Get-Command prompt).ScriptBlock
  function global:PSConsoleHostReadLine {
    $cotaLine = & $global:__cota_original_readline @args
    if (-not [string]::IsNullOrWhiteSpace($cotaLine)) { __cota_activity C }
    return $cotaLine
  }
  function global:prompt {
    $cotaPrompt = & $global:__cota_original_prompt @args
    __cota_activity D
    return $cotaPrompt
  }
}
Remove-Variable cotaReadLine -ErrorAction SilentlyContinue
`,
}
