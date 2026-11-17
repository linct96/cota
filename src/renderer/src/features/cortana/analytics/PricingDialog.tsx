import { useCallback, useEffect, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { unwrap } from '../../../../../shared/contracts'
import type { ModelPrice } from '../../../../../shared/usage-analytics'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const priceKey = (item: Pick<ModelPrice, 'provider' | 'model'>) =>
  JSON.stringify([item.provider.toLowerCase(), item.model.toLowerCase()])
const priceText = (value: number | null) => (value === null ? '—' : `$${value}`)
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法处理模型定价。'

export function PricingDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged: () => void
}) {
  const [prices, setPrices] = useState<ModelPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<ModelPrice | 'new'>()
  const [deleting, setDeleting] = useState<ModelPrice>()
  const [catalog, setCatalog] = useState<ModelPrice[]>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      setPrices(unwrap(await window.desktop.usageAnalytics.listPrices()))
      setError(undefined)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    void window.desktop.usageAnalytics
      .listPrices()
      .then((result) => {
        if (!cancelled) setPrices(unwrap(result))
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function remove() {
    if (!deleting || busy) return
    setBusy(true)
    try {
      unwrap(
        await window.desktop.usageAnalytics.deletePrice({
          provider: deleting.provider,
          model: deleting.model,
        }),
      )
      setDeleting(undefined)
      await load()
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught))
      setDeleting(undefined)
    } finally {
      setBusy(false)
    }
  }
  async function fetchCatalog() {
    setBusy(true)
    setError(undefined)
    try {
      setCatalog(unwrap(await window.desktop.usageAnalytics.fetchPrices()))
      setSelected(new Set())
      setSearch('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  async function importSelected() {
    if (!catalog || !selected.size || busy) return
    setBusy(true)
    try {
      const count = unwrap(
        await window.desktop.usageAnalytics.importPrices(
          catalog.filter((item) => selected.has(priceKey(item))),
        ),
      )
      setCatalog(undefined)
      await load()
      onChanged()
      toast.success(`已导入 ${count} 个模型定价。`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  const existing = new Set(prices.map(priceKey))
  const matches =
    catalog?.filter((item) =>
      `${item.provider} ${item.model}`.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? []

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="pricing-dialog flex max-h-[calc(100vh-4rem)] flex-col sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader className="pricing-dialog-header">
          <DialogTitle className="pricing-dialog-title">
            {editing
              ? editing === 'new'
                ? '新增模型定价'
                : '编辑模型定价'
              : catalog
                ? '导入模型定价'
                : '模型定价'}
          </DialogTitle>
          <DialogDescription className="pricing-dialog-description">
            {editing
              ? '价格单位：美元 / 百万 Token。'
              : catalog
                ? '选择要导入的模型。'
                : '用于估算会话费用。'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert className="pricing-error" variant="destructive">
            <AlertDescription className="pricing-error-message">{error}</AlertDescription>
          </Alert>
        )}
        {editing ? (
          <PriceEditor
            key={editing === 'new' ? 'new' : priceKey(editing)}
            price={editing === 'new' ? undefined : editing}
            onCancel={() => {
              setEditing(undefined)
              setError(undefined)
            }}
            onSave={async (price) => {
              setBusy(true)
              try {
                unwrap(await window.desktop.usageAnalytics.savePrice(price, editing !== 'new'))
                setEditing(undefined)
                await load()
                onChanged()
              } finally {
                setBusy(false)
              }
            }}
          />
        ) : catalog ? (
          <>
            <Field className="pricing-search-field">
              <FieldLabel className="pricing-search-label" htmlFor="pricing-search">
                搜索模型
              </FieldLabel>
              <Input
                className="pricing-search-input"
                id="pricing-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <fieldset
              className="pricing-catalog-list min-h-0 flex-1 overflow-y-auto border-y"
              aria-label="模型价格"
            >
              {matches.slice(0, 100).map((item) => {
                const id = priceKey(item)
                const saved = existing.has(id)
                return (
                  <label
                    className="pricing-catalog-row flex items-center gap-3 border-b py-2 last:border-b-0"
                    key={id}
                  >
                    <Checkbox
                      className="pricing-catalog-checkbox"
                      checked={selected.has(id)}
                      disabled={saved || busy || (selected.size >= 500 && !selected.has(id))}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (checked) next.add(id)
                          else next.delete(id)
                          return next
                        })
                      }
                    />
                    <span className="pricing-catalog-model min-w-0 flex-1 truncate">
                      {item.provider} / {item.model}
                    </span>
                    <span className="pricing-catalog-price shrink-0 text-xs text-muted-foreground">
                      {saved ? '已添加' : `${priceText(item.input)} / ${priceText(item.output)}`}
                    </span>
                  </label>
                )
              })}
              {!matches.length && (
                <p className="pricing-catalog-empty py-8 text-center text-sm text-muted-foreground">
                  没有匹配的模型
                </p>
              )}
              {matches.length > 100 && (
                <p className="pricing-catalog-overflow py-2 text-center text-xs text-muted-foreground">
                  结果较多，请继续输入模型名称。
                </p>
              )}
            </fieldset>
            <DialogFooter className="pricing-catalog-footer">
              <Button
                className="pricing-catalog-back"
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => {
                  setCatalog(undefined)
                  setError(undefined)
                }}
              >
                返回
              </Button>
              <Button
                className="pricing-catalog-import"
                type="button"
                disabled={busy || !selected.size}
                onClick={() => void importSelected()}
              >
                导入{selected.size ? ` (${selected.size})` : ''}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="pricing-actions flex flex-wrap gap-2">
              <Button
                className="pricing-add-button"
                size="sm"
                type="button"
                disabled={busy || loading}
                onClick={() => setEditing('new')}
              >
                <Plus className="pricing-add-icon" data-icon="inline-start" aria-hidden="true" />
                新增定价
              </Button>
              <Button
                className="pricing-import-button"
                variant="outline"
                size="sm"
                type="button"
                disabled={busy || loading}
                onClick={() => void fetchCatalog()}
              >
                <Download
                  className="pricing-import-icon"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                {busy ? '加载中…' : '从 models.dev 导入'}
              </Button>
            </div>
            <div
              className="pricing-list min-h-0 flex-1 overflow-y-auto border-y"
              aria-busy={loading}
            >
              {loading ? (
                <p className="pricing-loading py-8 text-center text-sm text-muted-foreground">
                  正在读取定价…
                </p>
              ) : prices.length ? (
                prices.map((item) => (
                  <div
                    className="pricing-row flex items-center gap-3 border-b py-3 last:border-b-0"
                    key={priceKey(item)}
                  >
                    <div className="pricing-row-content min-w-0 flex-1">
                      <p
                        className="pricing-row-model truncate font-medium"
                        title={`${item.provider} / ${item.model}`}
                      >
                        {item.provider} / {item.model}
                      </p>
                      <p className="pricing-row-rates mt-1 text-xs text-muted-foreground">
                        输入 {priceText(item.input)} · 输出 {priceText(item.output)} · 缓存读取{' '}
                        {priceText(item.cacheRead)} · 写入 {priceText(item.cacheWrite)}
                      </p>
                    </div>
                    <Button
                      className="pricing-edit-button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`编辑 ${item.model} 定价`}
                      onClick={() => setEditing(item)}
                    >
                      <Pencil className="pricing-edit-icon" aria-hidden="true" />
                    </Button>
                    <Button
                      className="pricing-delete-button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除 ${item.model} 定价`}
                      onClick={() => setDeleting(item)}
                    >
                      <Trash2 className="pricing-delete-icon" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="pricing-empty py-8 text-center text-sm text-muted-foreground">
                  还没有模型定价
                </p>
              )}
            </div>
          </>
        )}
        <AlertDialog
          open={!!deleting}
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(undefined)
          }}
        >
          <AlertDialogContent className="pricing-delete-dialog">
            <AlertDialogHeader className="pricing-delete-header">
              <AlertDialogTitle className="pricing-delete-title">删除模型定价？</AlertDialogTitle>
              <AlertDialogDescription className="pricing-delete-description">
                删除 {deleting?.model} 的价格后，相关用量将显示为未定价。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="pricing-delete-footer">
              <AlertDialogCancel className="pricing-delete-cancel" disabled={busy}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                className="pricing-delete-confirm"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

const identifier = z
  .string()
  .trim()
  .min(1, '请输入名称。')
  .max(200)
  .regex(/^[^\0\r\n]+$/, '名称不能包含换行。')
const amount = z
  .string()
  .trim()
  .max(40)
  .regex(/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)?$/, '请输入非负数字。')
  .refine((value) => !value || Number(value) <= 1_000_000, '价格过大。')
const formSchema = z.object({
  provider: identifier,
  model: identifier,
  input: amount,
  output: amount,
  cacheRead: amount,
  cacheWrite: amount,
})
const fields = [
  { name: 'provider', label: 'Provider' },
  { name: 'model', label: '模型 ID' },
  { name: 'input', label: '输入' },
  { name: 'output', label: '输出' },
  { name: 'cacheRead', label: '缓存读取' },
  { name: 'cacheWrite', label: '缓存写入' },
] as const

function PriceEditor({
  price,
  onCancel,
  onSave,
}: {
  price?: ModelPrice
  onCancel: () => void
  onSave: (price: ModelPrice) => Promise<void>
}) {
  const [error, setError] = useState<string>()
  const value = (rate: number | null | undefined) => (rate == null ? '' : String(rate))
  const form = useForm({
    defaultValues: {
      provider: price?.provider ?? '',
      model: price?.model ?? '',
      input: value(price?.input),
      output: value(price?.output),
      cacheRead: value(price?.cacheRead),
      cacheWrite: value(price?.cacheWrite),
    },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: formSchema },
    onSubmitInvalid: ({ formApi }) => {
      const first = fields.find(({ name }) => !formApi.getFieldMeta(name)?.isValid)
      if (first) document.getElementById(`price-${first.name}`)?.focus()
    },
    onSubmit: async ({ value: submitted }) => {
      setError(undefined)
      const decimal = (raw: string) => (raw.trim() ? Number(raw) : null)
      try {
        await onSave({
          provider: submitted.provider.trim(),
          model: submitted.model.trim(),
          input: decimal(submitted.input),
          output: decimal(submitted.output),
          cacheRead: decimal(submitted.cacheRead),
          cacheWrite: decimal(submitted.cacheWrite),
        })
      } catch (caught) {
        setError(errorMessage(caught))
      }
    },
  })
  return (
    <form
      className="pricing-editor flex min-h-0 flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {error && (
        <Alert className="pricing-editor-error" variant="destructive">
          <AlertDescription className="pricing-editor-error-message">{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="pricing-editor-fields grid grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
        {fields.map(({ name, label }) => (
          <form.Field name={name} key={name}>
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field className="pricing-editor-field" data-invalid={invalid}>
                  <FieldLabel className="pricing-editor-label" htmlFor={`price-${name}`}>
                    {label}
                  </FieldLabel>
                  <Input
                    className="pricing-editor-input"
                    id={`price-${name}`}
                    name={name}
                    value={field.state.value}
                    required={name === 'provider' || name === 'model'}
                    disabled={!!price && (name === 'provider' || name === 'model')}
                    inputMode={name === 'provider' || name === 'model' ? 'text' : 'decimal'}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `price-${name}-error` : undefined}
                  />
                  {invalid && (
                    <FieldError
                      className="pricing-editor-field-error"
                      id={`price-${name}-error`}
                      errors={field.state.meta.errors}
                    />
                  )}
                </Field>
              )
            }}
          </form.Field>
        ))}
      </FieldGroup>
      <DialogFooter className="pricing-editor-footer">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <>
              <Button
                className="pricing-editor-cancel"
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={onCancel}
              >
                取消
              </Button>
              <Button className="pricing-editor-save" type="submit" disabled={submitting}>
                {submitting ? '保存中…' : '保存'}
              </Button>
            </>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
