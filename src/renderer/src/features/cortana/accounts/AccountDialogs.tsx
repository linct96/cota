import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import {
  ACCOUNT_PRODUCTS,
  accountFormSchema,
  renameAccountSchema,
} from '../../../../../shared/accounts'
import type { AccountProduct, AccountProfile } from '../../../../../shared/accounts'
import { oauthActive, useCortana } from '@/features/cortana/cortana-store'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

const browserSchema = z.object(accountFormSchema.shape)

export function AddAccountDialog({
  product,
  onClose,
}: {
  product: AccountProduct
  onClose: () => void
}) {
  const draft = useCortana((state) => state.addDrafts[product])
  const pending = useCortana((state) => !!state.pending[`add:${product}`])
  const operationError = useCortana((state) => state.operationErrors[`add:${product}`])
  const addAccount = useCortana((state) => state.addAccount)
  const clearDraft = useCortana((state) => state.clearAddDraft)
  const progress = useCortana((state) => state.oauthProgress)
  const startOAuth = useCortana((state) => state.startOAuth)
  const cancelOAuth = useCortana((state) => state.cancelOAuth)
  const [open, setOpen] = useState(true)
  const [method, setMethod] = useState<'browser' | 'credential' | 'relay'>(
    draft?.mode || (product === 'pi' ? 'credential' : 'browser'),
  )
  const authorizing = oauthActive(progress) && progress?.product === product
  const error =
    method === 'browser'
      ? progress?.product === product && progress.stage === 'error'
        ? progress.message
        : undefined
      : operationError
  const wasPending = useRef(pending)
  const previousOAuth = useRef(progress?.stage)
  const form = useForm({
    defaultValues: {
      alias: draft?.alias || '',
      mode: draft?.mode || 'credential',
      credential: draft?.credential || '',
      apiBaseUrl: draft?.apiBaseUrl || '',
      apiKey: draft?.apiKey || '',
    },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: method === 'browser' ? browserSchema : accountFormSchema },
    onSubmit: async ({ value }) => {
      if (!open || pending) return
      if (method === 'browser') {
        if (!oauthActive(progress)) await startOAuth(product, value.alias.trim())
      } else {
        const saved = await addAccount({
          ...value,
          product,
          alias: value.alias.trim(),
          credential: value.credential.trim(),
          apiBaseUrl: value.apiBaseUrl.trim(),
          apiKey: value.apiKey.trim(),
        })
        if (saved) setOpen(false)
      }
    },
  })

  useEffect(() => {
    form.reset()
  }, [form])
  useEffect(() => {
    if (pending) wasPending.current = true
    else if (wasPending.current && (operationError || !draft)) {
      // oxlint-disable-next-line react/set-state-in-effect -- A reopened dialog follows its background save.
      if (!operationError) setOpen(false)
      wasPending.current = false
    }
  }, [pending, operationError, draft])
  useEffect(() => {
    if (
      progress?.product === product &&
      progress.stage === 'success' &&
      previousOAuth.current !== 'success' &&
      method === 'browser'
    )
      setOpen(false)
    previousOAuth.current = progress?.stage
  }, [progress, product, method])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => setOpen(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="account-add-dialog max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="account-add-header">
          <DialogTitle className="account-add-title">
            添加 {ACCOUNT_PRODUCTS[product].name} 账号
          </DialogTitle>
          <DialogDescription className="account-add-description">
            保存后可在账号列表中切换使用。
          </DialogDescription>
        </DialogHeader>
        <form
          className="account-add-form flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <Tabs
            value={method}
            onValueChange={(value) => {
              if (pending) return
              const next = value as typeof method
              setMethod(next)
              form.setFieldValue('mode', next === 'relay' ? 'relay' : 'credential')
            }}
            className="account-add-methods"
          >
            <TabsList className="account-add-method-list w-full" aria-label="添加方式">
              {product !== 'pi' && (
                <TabsTrigger className="account-add-browser-tab" value="browser" disabled={pending}>
                  浏览器登录
                </TabsTrigger>
              )}
              <TabsTrigger
                className="account-add-credential-tab"
                value="credential"
                disabled={pending}
              >
                导入凭据
              </TabsTrigger>
              {['codex', 'claude', 'grok'].includes(product) && (
                <TabsTrigger className="account-add-relay-tab" value="relay" disabled={pending}>
                  API 账号
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <fieldset className="account-add-fieldset min-w-0" disabled={submitting || pending}>
                <FieldGroup className="account-add-fields">
                  <form.Field name="alias">
                    {(field) => {
                      const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field className="account-alias-field" data-invalid={invalid}>
                          <FieldLabel className="account-alias-label" htmlFor="account-alias">
                            名称（可选）
                          </FieldLabel>
                          <Input
                            className="account-alias-input"
                            id="account-alias"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={invalid}
                            aria-describedby={invalid ? 'account-alias-error' : undefined}
                            placeholder="例如：工作账号"
                            maxLength={80}
                          />
                          {invalid && (
                            <FieldError
                              className="account-alias-error"
                              id="account-alias-error"
                              errors={field.state.meta.errors}
                            />
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                  {method === 'credential' && (
                    <form.Field name="credential">
                      {(field) => {
                        const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                        return (
                          <Field className="account-credential-field" data-invalid={invalid}>
                            <FieldLabel
                              className="account-credential-label"
                              htmlFor="account-credential"
                            >
                              认证信息
                            </FieldLabel>
                            <Textarea
                              className="account-credential-input min-h-40 resize-y font-mono"
                              id="account-credential"
                              value={field.state.value}
                              autoComplete="off"
                              spellCheck={false}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              aria-invalid={invalid}
                              aria-describedby={`account-credential-description${invalid ? ' account-credential-error' : ''}`}
                              placeholder={
                                product === 'codex'
                                  ? '粘贴 auth.json 或 refresh_token'
                                  : '粘贴账号凭据 JSON'
                              }
                            />
                            <FieldDescription
                              className="account-credential-description"
                              id="account-credential-description"
                            >
                              {product === 'pi'
                                ? '也可先在 Pi 中执行 /login，再使用「导入当前登录」。'
                                : '凭据将以明文保存在本机。'}
                            </FieldDescription>
                            {invalid && (
                              <FieldError
                                className="account-credential-error"
                                id="account-credential-error"
                                errors={field.state.meta.errors}
                              />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  )}
                  {method === 'relay' && (
                    <>
                      <form.Field name="apiBaseUrl">
                        {(field) => {
                          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                          return (
                            <Field className="account-api-url-field" data-invalid={invalid}>
                              <FieldLabel
                                className="account-api-url-label"
                                htmlFor="account-api-url"
                              >
                                API 地址
                              </FieldLabel>
                              <Input
                                className="account-api-url-input"
                                id="account-api-url"
                                type="url"
                                value={field.state.value}
                                placeholder={
                                  product === 'claude'
                                    ? 'https://api.example.com'
                                    : 'https://api.example.com/v1'
                                }
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={invalid}
                                aria-describedby={invalid ? 'account-api-url-error' : undefined}
                              />
                              {invalid && (
                                <FieldError
                                  className="account-api-url-error"
                                  id="account-api-url-error"
                                  errors={field.state.meta.errors}
                                />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                      <form.Field name="apiKey">
                        {(field) => {
                          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                          return (
                            <Field className="account-api-key-field" data-invalid={invalid}>
                              <FieldLabel
                                className="account-api-key-label"
                                htmlFor="account-api-key"
                              >
                                API Key
                              </FieldLabel>
                              <Input
                                className="account-api-key-input"
                                id="account-api-key"
                                type="password"
                                autoComplete="new-password"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={invalid}
                                aria-describedby={invalid ? 'account-api-key-error' : undefined}
                              />
                              {invalid && (
                                <FieldError
                                  className="account-api-key-error"
                                  id="account-api-key-error"
                                  errors={field.state.meta.errors}
                                />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                    </>
                  )}
                  {method === 'browser' && (
                    <FieldDescription className="account-browser-description">
                      将在默认浏览器中完成授权，Cota 会自动接收结果。
                    </FieldDescription>
                  )}
                </FieldGroup>
              </fieldset>
            )}
          </form.Subscribe>
          {authorizing && (
            <Alert className="account-oauth-progress">
              <LoaderCircle
                className="account-oauth-spinner motion-safe:animate-spin"
                aria-hidden="true"
              />
              <AlertDescription className="account-oauth-message">
                {progress.message}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert className="account-add-error" variant="destructive">
              <AlertDescription className="account-add-error-message">{error}</AlertDescription>
            </Alert>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <DialogFooter className="account-add-footer">
                {authorizing && progress.stage === 'waiting' && (
                  <Button
                    className="account-oauth-cancel"
                    variant="outline"
                    type="button"
                    onClick={() => void cancelOAuth()}
                  >
                    取消授权
                  </Button>
                )}
                <Button
                  className="account-add-cancel"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    if (!pending && !authorizing) clearDraft(product)
                    setOpen(false)
                  }}
                >
                  {submitting || pending || authorizing ? '关闭' : '取消'}
                </Button>
                <Button
                  className="account-add-submit"
                  type="submit"
                  disabled={
                    submitting || pending || (method === 'browser' && oauthActive(progress))
                  }
                  title={
                    method === 'browser' && oauthActive(progress) && !authorizing
                      ? '已有浏览器授权正在进行'
                      : undefined
                  }
                >
                  {submitting ? (
                    <LoaderCircle
                      className="account-submit-spinner animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  ) : method === 'browser' ? (
                    <ExternalLink
                      className="account-browser-icon"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  ) : null}
                  {method === 'browser' ? '在浏览器中登录' : '保存账号'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RenameAccountDialog({
  account,
  onClose,
}: {
  account: AccountProfile
  onClose: () => void
}) {
  const draft = useCortana((state) => state.renameDrafts[account.id])
  const pending = useCortana((state) => !!state.pending[`rename:${account.id}`])
  const error = useCortana((state) => state.operationErrors[`rename:${account.id}`])
  const renameAccount = useCortana((state) => state.renameAccount)
  const clearDraft = useCortana((state) => state.clearRenameDraft)
  const [open, setOpen] = useState(true)
  const wasPending = useRef(pending)
  const form = useForm({
    defaultValues: { alias: draft ?? account.alias },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: z.object({ alias: renameAccountSchema.shape.alias }) },
    onSubmit: async ({ value }) => {
      if (!open || pending) return
      if (await renameAccount(account, value.alias.trim())) setOpen(false)
    },
  })
  useEffect(() => {
    form.reset()
  }, [form])
  useEffect(() => {
    if (pending) wasPending.current = true
    else if (wasPending.current && (error || draft === undefined)) {
      // oxlint-disable-next-line react/set-state-in-effect -- A reopened dialog follows its background save.
      if (!error) setOpen(false)
      wasPending.current = false
    }
  }, [pending, error, draft])
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => setOpen(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="account-rename-dialog" showCloseButton={false}>
        <DialogHeader className="account-rename-header">
          <DialogTitle className="account-rename-title">重命名账号</DialogTitle>
        </DialogHeader>
        <form
          className="account-rename-form flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup className="account-rename-fields">
            <form.Field name="alias">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="account-rename-field" data-invalid={invalid}>
                    <FieldLabel className="account-rename-label" htmlFor="account-rename">
                      账号名称
                    </FieldLabel>
                    <Input
                      className="account-rename-input"
                      id="account-rename"
                      value={field.state.value}
                      disabled={pending}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? 'account-rename-error' : undefined}
                      maxLength={80}
                    />
                    {invalid && (
                      <FieldError
                        className="account-rename-error"
                        id="account-rename-error"
                        errors={field.state.meta.errors}
                      />
                    )}
                  </Field>
                )
              }}
            </form.Field>
          </FieldGroup>
          {error && (
            <Alert className="account-rename-request-error" variant="destructive">
              <AlertDescription className="account-rename-error-message">{error}</AlertDescription>
            </Alert>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <DialogFooter className="account-rename-footer">
                <Button
                  className="account-rename-cancel"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!pending) clearDraft(account.id)
                    setOpen(false)
                  }}
                >
                  {submitting || pending ? '关闭' : '取消'}
                </Button>
                <Button
                  className="account-rename-submit"
                  type="submit"
                  disabled={submitting || pending}
                >
                  {submitting || pending ? '保存中…' : '保存'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}
