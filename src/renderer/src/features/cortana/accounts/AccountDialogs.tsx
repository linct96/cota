import { useCallback, useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import {
  ACCOUNT_PRODUCTS,
  accountFormSchema,
  renameAccountSchema,
  type AccountOAuthProgress,
  type AccountProduct,
  type AccountProfile,
} from '../../../../../shared/accounts'
import { unwrap } from '../../../../../shared/contracts'
import { Alert, AlertDescription } from '../../../components/ui/alert'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs'
import { Textarea } from '../../../components/ui/textarea'

const browserSchema = z.object(accountFormSchema.shape)
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请稍后重试。'

export function AddAccountDialog({
  product,
  onClose,
  onSaved,
}: {
  product: AccountProduct
  onClose(): void
  onSaved(): void
}) {
  const [method, setMethod] = useState<'browser' | 'credential' | 'relay'>(
    product === 'pi' ? 'credential' : 'browser',
  )
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState<AccountOAuthProgress>()
  const progressRef = useRef<AccountOAuthProgress | undefined>(undefined)
  const pendingRef = useRef(false)
  const authorizing = progress?.stage === 'waiting' || progress?.stage === 'exchanging'
  const form = useForm({
    defaultValues: {
      alias: '',
      mode: 'credential' as 'credential' | 'relay',
      credential: '',
      apiBaseUrl: '',
      apiKey: '',
    },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: method === 'browser' ? browserSchema : accountFormSchema },
    onSubmit: async ({ value }) => {
      if (pendingRef.current || authorizing) return
      pendingRef.current = true
      setError(undefined)
      try {
        if (method === 'browser') {
          unwrap(await window.desktop.accounts.startOAuth(product, value.alias.trim()))
        } else {
          unwrap(
            await window.desktop.accounts.add({
              ...value,
              product,
              alias: value.alias.trim(),
              credential: value.credential.trim(),
              apiBaseUrl: value.apiBaseUrl.trim(),
              apiKey: value.apiKey.trim(),
            }),
          )
          onSaved()
        }
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        pendingRef.current = false
      }
    },
  })

  useEffect(() => {
    form.reset()
  }, [form])
  useEffect(() => {
    const stop = window.desktop.accounts.onOAuth((next) => {
      if (next.product !== product) return
      progressRef.current = next
      setProgress(next)
      if (next.stage === 'error') setError(next.message)
      if (next.stage === 'success') onSaved()
    })
    return () => {
      stop()
      if (['waiting', 'exchanging'].includes(progressRef.current?.stage || ''))
        void window.desktop.accounts.cancelOAuth().catch(() => {})
    }
  }, [product, onSaved])

  const close = useCallback(async () => {
    if (pendingRef.current || progressRef.current?.stage === 'exchanging') return
    if (progressRef.current?.stage === 'waiting') {
      try {
        unwrap(await window.desktop.accounts.cancelOAuth())
      } catch (cause) {
        setError(errorText(cause))
        return
      }
    }
    form.reset()
    onClose()
  }, [form, onClose])

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open) {
          details.cancel()
          void close()
        }
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
              if (authorizing || pendingRef.current) return
              const next = value as typeof method
              setMethod(next)
              form.setFieldValue('mode', next === 'relay' ? 'relay' : 'credential')
              setError(undefined)
            }}
            className="account-add-methods"
          >
            <TabsList className="account-add-method-list w-full" aria-label="添加方式">
              {product !== 'pi' && (
                <TabsTrigger
                  className="account-add-browser-tab"
                  value="browser"
                  disabled={authorizing}
                >
                  浏览器登录
                </TabsTrigger>
              )}
              <TabsTrigger
                className="account-add-credential-tab"
                value="credential"
                disabled={authorizing}
              >
                导入凭据
              </TabsTrigger>
              {['codex', 'claude'].includes(product) && (
                <TabsTrigger className="account-add-relay-tab" value="relay" disabled={authorizing}>
                  API 账号
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <fieldset
                className="account-add-fieldset min-w-0"
                disabled={submitting || authorizing}
              >
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
                            disabled={authorizing}
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
                                : '凭据将加密保存在本机。请勿粘贴与此账号无关的配置。'}
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
              <LoaderCircle className="account-oauth-spinner animate-spin" aria-hidden="true" />
              <AlertDescription className="account-oauth-message">
                {progress?.message}
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
                <Button
                  className="account-add-cancel"
                  variant="outline"
                  type="button"
                  disabled={submitting || progress?.stage === 'exchanging'}
                  onClick={() => void close()}
                >
                  {authorizing ? '取消授权' : '取消'}
                </Button>
                <Button
                  className="account-add-submit"
                  type="submit"
                  disabled={submitting || authorizing}
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
  onSaved,
}: {
  account: AccountProfile
  onClose(): void
  onSaved(): void
}) {
  const [error, setError] = useState<string>()
  const saving = useRef(false)
  const form = useForm({
    defaultValues: { alias: account.alias },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: z.object({ alias: renameAccountSchema.shape.alias }) },
    onSubmit: async ({ value }) => {
      if (saving.current) return
      saving.current = true
      setError(undefined)
      try {
        unwrap(await window.desktop.accounts.rename({ id: account.id, alias: value.alias.trim() }))
        onSaved()
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        saving.current = false
      }
    },
  })
  useEffect(() => {
    form.reset()
  }, [form])
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open) {
          if (saving.current) details.cancel()
          else onClose()
        }
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
                  disabled={submitting}
                  onClick={onClose}
                >
                  取消
                </Button>
                <Button className="account-rename-submit" type="submit" disabled={submitting}>
                  {submitting ? '保存中…' : '保存'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}
