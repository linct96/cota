import { Fragment, useEffect, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import { Copy, LoaderCircle, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { unwrap } from '../../../shared/contracts'
import {
  hostingHostSchema,
  hostingProviderSchema,
  type HostingProvider,
  type HostingConnection,
  type HostingAccounts,
} from '../../../shared/code-hosting'
import { useLoadingIndicator } from '../lib/use-loading-indicator'
import { LoadingContent } from './LoadingContent'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyTitle } from './ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Separator } from './ui/separator'

const schema = z.object({ host: hostingHostSchema.or(z.literal('')) })
const platforms = {
  github: { name: 'GitHub', cli: 'gh', host: 'github.com' },
  gitlab: { name: 'GitLab', cli: 'glab', host: 'gitlab.com' },
}

type ConnectionStatus = { checking?: boolean } & (
  | HostingAccounts
  | { status: 'unchecked' }
  | { status: 'error'; message: string }
)

const connectionStates = {
  unchecked: { label: '未检测', variant: 'secondary' },
  detected: { label: '已检测', variant: 'secondary' },
  disconnected: { label: '未登录', variant: 'warning' },
  'cli-unavailable': { label: 'CLI 不可用', variant: 'warning' },
  error: { label: '检测失败', variant: 'destructive' },
} as const

export function CodeHostingSettings() {
  const [connections, setConnections] = useState<Record<HostingProvider, ConnectionStatus>>({
    github: { status: 'unchecked' },
    gitlab: { status: 'unchecked' },
  })
  const [initialPending, setInitialPending] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [configuring, setConfiguring] = useState<HostingProvider>()
  const pending = useRef(false)
  const alive = useRef(true)
  const detectingVisible = useLoadingIndicator(detecting)
  const hasChecked = Object.values(connections).some(
    (connection) => connection.status !== 'unchecked',
  )

  useEffect(() => {
    alive.current = true
    void detect()
    return () => {
      alive.current = false
    }
  }, [])

  async function scan(provider: HostingProvider) {
    setConnections((previous) => ({
      ...previous,
      [provider]: { ...previous[provider], checking: true },
    }))
    try {
      const result = unwrap(await window.desktop.codeHosting.accounts(provider))
      if (alive.current) setConnections((previous) => ({ ...previous, [provider]: result }))
    } catch (cause) {
      if (alive.current) {
        setConnections((previous) => ({
          ...previous,
          [provider]: {
            status: 'error',
            message: cause instanceof Error ? cause.message : '检测失败，请重试。',
          },
        }))
      }
      throw cause
    }
  }

  async function detect() {
    if (pending.current || detectingVisible || configuring) return
    pending.current = true
    setDetecting(true)
    try {
      await Promise.allSettled(hostingProviderSchema.options.map((provider) => scan(provider)))
    } finally {
      pending.current = false
      if (alive.current) {
        setDetecting(false)
        setInitialPending(false)
      }
    }
  }

  return (
    <section
      className="code-hosting-settings flex min-h-0 flex-1 flex-col gap-6"
      aria-labelledby="code-hosting-settings-title"
    >
      <div className="code-hosting-settings-heading typeset">
        <h1 id="code-hosting-settings-title" className="code-hosting-settings-title">
          代码托管
        </h1>
      </div>
      <LoadingContent pending={initialPending} label="代码托管配置读取中..." showLabel>
        {!initialPending && (
          <FieldGroup className="code-hosting-settings-groups gap-8">
            <section
              className="code-hosting-settings-group flex flex-col gap-3"
              aria-labelledby="code-hosting-connection-title"
              aria-busy={detecting}
            >
              <div className="code-hosting-settings-group-header flex flex-wrap items-start justify-between gap-3">
                <div className="code-hosting-settings-group-heading flex min-w-0 flex-1 basis-64 flex-col gap-1">
                  <h4
                    id="code-hosting-connection-title"
                    className="code-hosting-settings-group-title flex min-h-8 items-center text-sm font-normal text-muted-foreground"
                  >
                    CLI 连接
                  </h4>
                </div>
                <Button
                  className="code-hosting-detect"
                  variant="outline"
                  size="lg"
                  disabled={detecting || detectingVisible || !!configuring}
                  onClick={() => void detect()}
                >
                  <RefreshCw className="code-hosting-detect-icon" data-icon="inline-start" />
                  {detectingVisible ? '检测中…' : hasChecked ? '重新检测' : '检测连接'}
                </Button>
              </div>
              <Card className="code-hosting-settings-card" aria-busy={detecting}>
                {hostingProviderSchema.options.map((provider, index) => (
                  <Fragment key={provider}>
                    {index > 0 && <Separator className="code-hosting-settings-separator" />}
                    <CodeHostingConnectionRow
                      provider={provider}
                      connection={connections[provider]}
                      disabled={detecting || detectingVisible}
                      open={configuring === provider}
                      onOpenChange={(open) => {
                        if (!pending.current) setConfiguring(open ? provider : undefined)
                      }}
                      onConnect={async (host) => {
                        const result = unwrap(
                          await window.desktop.codeHosting.connection(provider, host),
                        )
                        if (alive.current) {
                          setConnections((previous) => {
                            const current = previous[provider]
                            const accounts = current.status === 'detected' ? current.accounts : []
                            const updated = accounts.map((account) => {
                              if (account.host !== host) return account
                              if (result.status !== 'connected')
                                return account.active
                                  ? { ...account, status: 'error' as const }
                                  : account
                              return {
                                ...account,
                                active: account.account === result.account,
                                status:
                                  account.account === result.account
                                    ? ('connected' as const)
                                    : account.status,
                              }
                            })
                            if (
                              result.status === 'connected' &&
                              !updated.some(
                                (account) =>
                                  account.host === host && account.account === result.account,
                              )
                            ) {
                              updated.push({
                                host,
                                account: result.account,
                                active: true,
                                status: 'connected',
                              })
                            }
                            return {
                              ...previous,
                              [provider]:
                                result.status === 'connected' || updated.length > 0
                                  ? { status: 'detected', accounts: updated }
                                  : result,
                            }
                          })
                        }
                        return result
                      }}
                    />
                  </Fragment>
                ))}
              </Card>
            </section>
          </FieldGroup>
        )}
      </LoadingContent>
    </section>
  )
}

function CodeHostingConnectionRow({
  provider,
  connection,
  disabled,
  open,
  onOpenChange,
  onConnect,
}: {
  provider: HostingProvider
  connection: ConnectionStatus
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (host: string) => Promise<HostingConnection>
}) {
  const { name, cli, host: defaultHost } = platforms[provider]
  const hostId = `hosting-${provider}-host`
  const view = connectionStates[connection.status]
  const allAccounts = connection.status === 'detected' ? connection.accounts : []
  const accounts = allAccounts.filter((account) => account.status === 'connected')
  const primaryAccount = accounts.find((account) => account.active) ?? accounts[0]
  const action = primaryAccount ? '管理连接' : '连接'
  const checkingVisible = useLoadingIndicator(!!connection.checking)
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)
  const [guide, setGuide] = useState<{ host: string; account?: string }>()
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const lock = useRef(false)
  const alive = useRef(true)
  const form = useForm({
    defaultValues: { host: '' },
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (lock.current || disabled || connectingVisible) return
      const host = hostingHostSchema.parse(value.host.trim() || defaultHost)
      await verify(host)
    },
  })
  const submitting = useStore(form.store, (state) => state.isSubmitting)
  const connectingVisible = useLoadingIndicator(submitting || checking)
  const busy = submitting || checking
  const blocked = disabled || busy || connectingVisible || !!connection.checking || checkingVisible
  const command = guide ? `${cli} auth login --hostname ${guide.host}` : ''

  async function verify(host: string) {
    if (lock.current || disabled || connectingVisible) return
    lock.current = true
    setChecking(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await onConnect(host)
      if (!alive.current) return
      if (result.status === 'connected') {
        const existing = accounts.some(
          (account) => account.host === host && account.account === result.account,
        )
        setNotice(
          `${host} · ${result.account} 已连接${adding && existing ? '，无需重复添加' : ''}。`,
        )
        setGuide(undefined)
        setAdding(false)
        const endpoint = document.getElementById(
          `${hostId}-${encodeURIComponent(JSON.stringify([host, result.account]))}`,
        )
        endpoint?.scrollIntoView({ block: 'nearest' })
        endpoint?.focus({ preventScroll: true })
      } else {
        setError(result.message)
        setGuide({ host })
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '连接失败，请重试。')
    } finally {
      lock.current = false
      if (alive.current) setChecking(false)
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      toast.success('登录命令已复制')
    } catch {
      toast.error('复制失败，请手动复制登录命令。')
    }
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (lock.current || blocked) return
        if (next) {
          form.reset({ host: defaultHost })
          setAdding(allAccounts.length === 0)
          setGuide(undefined)
          setNotice(undefined)
          setError(
            connection.status === 'error' || connection.status === 'cli-unavailable'
              ? connection.message
              : undefined,
          )
        }
        onOpenChange(next)
      }}
    >
      <Field
        className="code-hosting-connection-row flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 min-h-8"
        aria-labelledby={`hosting-${provider}-label`}
        aria-busy={!!connection.checking}
      >
        <div className="code-hosting-connection-description flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <div className="code-hosting-connection-identity flex flex-wrap items-center gap-2">
            <h5
              id={`hosting-${provider}-label`}
              className="code-hosting-platform-name text-sm leading-5 font-medium"
            >
              {name}
            </h5>
            {!connection.checking &&
              !checkingVisible &&
              (primaryAccount || connection.status !== 'detected') && (
                <Badge
                  className="code-hosting-connection-status"
                  variant={primaryAccount ? 'success' : view.variant}
                  role="status"
                >
                  {primaryAccount ? '已连接' : view.label}
                </Badge>
              )}
          </div>
          <p className="code-hosting-connection-detail break-all select-text text-xs text-muted-foreground">
            {primaryAccount
              ? `${primaryAccount.host} · ${primaryAccount.account}${accounts.length > 1 ? ` 等${accounts.length}个远端地址` : ''}`
              : connection.status === 'detected'
                ? '未发现已授权账号，请在终端重新授权后再检测。'
                : connection.status === 'unchecked'
                  ? '点击「检测连接」扫描所有已登录账号。'
                  : 'message' in connection
                    ? connection.message
                    : ''}
          </p>
        </div>
        <div className="code-hosting-connection-control flex min-w-0 flex-col gap-2">
          {connection.status !== 'unchecked' && (
            <DialogTrigger
              render={
                <Button
                  className="code-hosting-connect"
                  variant="outline"
                  size="lg"
                  disabled={blocked}
                  aria-label={`${action} ${name}`}
                />
              }
            >
              {action}
            </DialogTrigger>
          )}
        </div>
      </Field>
      <DialogContent
        className="code-hosting-connect-dialog max-h-[85vh] overflow-y-auto"
        showCloseButton={!blocked}
        aria-busy={busy}
      >
        <DialogHeader className="code-hosting-connect-header">
          <DialogTitle className="code-hosting-connect-title">管理连接 {name}</DialogTitle>
        </DialogHeader>
        {allAccounts.length > 0 ? (
          <ul className="code-hosting-endpoints flex flex-col gap-4" aria-label={`${name} 连接`}>
            {allAccounts.map((account, index) => (
              <li
                className="code-hosting-endpoint flex flex-col gap-2"
                key={JSON.stringify([account.host, account.account])}
                id={`${hostId}-${encodeURIComponent(JSON.stringify([account.host, account.account]))}`}
                tabIndex={-1}
              >
                {index > 0 && <Separator className="code-hosting-endpoint-separator mb-2" />}
                <div className="code-hosting-endpoint-header flex items-center justify-between gap-3">
                  <div className="code-hosting-endpoint-identity flex min-w-0 flex-wrap items-center gap-2">
                    <h4 className="code-hosting-endpoint-name break-all select-text text-sm font-medium">
                      {account.host} · {account.account || '账号不可用'}
                    </h4>
                    <Badge
                      className="code-hosting-endpoint-status"
                      variant={account.status === 'connected' ? 'success' : 'warning'}
                    >
                      {account.status === 'connected' ? '已连接' : '验证失败'}
                    </Badge>
                    {account.active && account.status === 'connected' && (
                      <Badge className="code-hosting-endpoint-active" variant="secondary">
                        当前账号
                      </Badge>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={blocked}
                      render={
                        <Button
                          className="code-hosting-endpoint-menu-trigger"
                          variant="ghost"
                          size="icon"
                          aria-label={`管理 ${account.host} · ${account.account || '账号不可用'}`}
                        />
                      }
                    >
                      <MoreHorizontal className="code-hosting-endpoint-menu-icon" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="code-hosting-endpoint-menu" align="end">
                      <DropdownMenuGroup className="code-hosting-endpoint-actions">
                        <DropdownMenuItem
                          className="code-hosting-endpoint-recheck"
                          disabled={blocked}
                          onClick={() => void verify(account.host)}
                        >
                          检测 Host 当前账号
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="code-hosting-endpoint-authorize"
                          disabled={blocked}
                          onClick={() => {
                            setAdding(false)
                            setGuide({ host: account.host, account: account.account })
                            setNotice(undefined)
                            setError(undefined)
                          }}
                        >
                          授权指引
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        ) : !adding ? (
          <Empty className="code-hosting-endpoints-empty">
            <EmptyHeader className="code-hosting-endpoints-empty-header">
              <EmptyTitle className="code-hosting-endpoints-empty-title">暂无已连接端点</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : null}
        {!adding ? (
          <Button
            className="code-hosting-add-connection self-start"
            variant="outline"
            disabled={blocked}
            onClick={() => {
              form.reset({ host: defaultHost })
              setAdding(true)
              setGuide(undefined)
              setNotice(undefined)
              setError(undefined)
            }}
          >
            <Plus className="code-hosting-add-connection-icon" data-icon="inline-start" />
            新增连接
          </Button>
        ) : (
          <form
            className="code-hosting-connect-form flex flex-col gap-4"
            noValidate
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <FieldGroup className="code-hosting-connect-fields">
              <form.Field name="host">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field
                      className="code-hosting-host-field"
                      data-invalid={invalid}
                      disabled={blocked}
                    >
                      <FieldLabel className="code-hosting-host-label" htmlFor={hostId}>
                        新增连接 · Host
                      </FieldLabel>
                      <Input
                        id={hostId}
                        className="code-hosting-host-input"
                        autoFocus
                        value={field.state.value}
                        maxLength={253}
                        placeholder={defaultHost}
                        disabled={blocked}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value)
                          setError(undefined)
                          setGuide(undefined)
                        }}
                        aria-invalid={invalid}
                        aria-describedby={`${hostId}-description${invalid ? ` ${hostId}-error` : ''}`}
                      />
                      <FieldDescription
                        id={`${hostId}-description`}
                        className="code-hosting-host-description"
                      >
                        留空时使用 {defaultHost}。填写域名，可包含端口，不包含协议或路径。
                      </FieldDescription>
                      {invalid && (
                        <FieldError
                          id={`${hostId}-error`}
                          className="code-hosting-host-error"
                          errors={field.state.meta.errors}
                        />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
            <div className="code-hosting-add-actions flex justify-end gap-2">
              <Button
                className="code-hosting-add-cancel"
                type="button"
                variant="ghost"
                disabled={blocked}
                onClick={() => {
                  setAdding(false)
                  setGuide(undefined)
                  setError(undefined)
                }}
              >
                取消
              </Button>
              <Button className="code-hosting-connect-submit" type="submit" disabled={blocked}>
                {guide ? '重新检测' : '检测连接'}
              </Button>
            </div>
          </form>
        )}
        {guide && (
          <Alert className="code-hosting-authorization-guide" role="status">
            <AlertTitle className="code-hosting-authorization-title break-all">
              {guide.host}
              {guide.account ? ` · ${guide.account}` : ''} 授权指引
            </AlertTitle>
            <AlertDescription className="code-hosting-authorization-description flex flex-col gap-3">
              <p className="code-hosting-authorization-hint">
                在终端完成授权后，返回此处重新检测。
              </p>
              <code className="code-hosting-authorization-command break-all select-text">
                {command}
              </code>
              <div className="code-hosting-authorization-actions flex flex-wrap gap-2">
                <Button
                  className="code-hosting-copy-login"
                  variant="outline"
                  onClick={() => void copyCommand()}
                >
                  <Copy className="code-hosting-copy-login-icon" data-icon="inline-start" />
                  复制命令
                </Button>
                {!adding && (
                  <Button
                    className="code-hosting-authorization-recheck"
                    variant="outline"
                    disabled={blocked}
                    onClick={() => void verify(guide.host)}
                  >
                    检测 Host 当前账号
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
        {notice && (
          <p
            className="code-hosting-connection-notice break-all text-sm text-muted-foreground"
            role="status"
          >
            {notice}
          </p>
        )}
        <FieldError className="code-hosting-connect-error break-all">{error}</FieldError>
        <DialogFooter className="code-hosting-connect-footer">
          <Button
            className="code-hosting-connect-done"
            disabled={blocked}
            onClick={() => {
              if (!lock.current && !blocked) onOpenChange(false)
            }}
          >
            {connectingVisible && (
              <LoaderCircle
                className="code-hosting-connect-spinner motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />
            )}
            {connectingVisible ? '检测中…' : '完成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
