import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { Download, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModelPriceEditor } from './ModelPriceEditor'
import { PricingCatalog, usePricingCatalog } from './PricingCatalog'
import { errorMessage, modelPriceFields, priceKey } from './pricing-values'

export function PricingDialog({
  unpricedModels = [],
  onClose,
  onChanged,
}: {
  unpricedModels?: Pick<ModelPrice, 'provider' | 'model'>[]
  onClose: () => void
  onChanged: () => void
}) {
  const [prices, setPrices] = useState<ModelPrice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<ModelPrice | 'new'>()
  const [deleting, setDeleting] = useState<ModelPrice>()
  const [busy, setBusy] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [listProvider, setListProvider] = useState('all')
  const editorReturnFocus = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!editing && editorReturnFocus.current) {
      const trigger =
        document.getElementById(editorReturnFocus.current) ??
        document.getElementById('pricing-search')
      trigger?.focus()
      editorReturnFocus.current = undefined
    }
  }, [editing])
  const listProviders = Array.from(new Set(prices.map((item) => item.provider))).sort()
  const listTerms = listSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filteredPrices = prices.filter(
    (item) =>
      (listProvider === 'all' || item.provider === listProvider) &&
      listTerms.every((term) => `${item.provider} ${item.model}`.toLowerCase().includes(term)),
  )
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
  const { catalog, fetchCatalog } = usePricingCatalog({
    prices,
    busy,
    setBusy,
    setError,
    onImported: async () => {
      await load()
      onChanged()
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className={cn(
          'pricing-dialog flex max-h-[calc(100dvh-4rem)] flex-col sm:max-w-2xl',
          !editing && catalog && 'h-[min(38rem,calc(100dvh-4rem))]',
          !editing && !catalog && 'min-h-[min(24rem,calc(100dvh-4rem))]',
        )}
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
        </DialogHeader>
        {error && (
          <Alert className="pricing-error" variant="destructive">
            <AlertDescription className="pricing-error-message">{error}</AlertDescription>
          </Alert>
        )}
        {editing ? (
          <ModelPriceEditor
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
                await load()
                if (catalog) editorReturnFocus.current = 'pricing-search'
                setEditing(undefined)
                onChanged()
              } finally {
                setBusy(false)
              }
            }}
          />
        ) : catalog ? (
          <PricingCatalog
            catalog={catalog}
            unpricedModels={unpricedModels}
            onEdit={(price, triggerId) => {
              editorReturnFocus.current = triggerId
              setEditing(price)
            }}
          />
        ) : (
          <>
            <div className="pricing-actions flex flex-wrap items-center gap-2">
              <Select
                value={listProvider}
                onValueChange={(value) => value && setListProvider(value)}
              >
                <SelectTrigger
                  className="pricing-list-provider w-28 shrink-0"
                  aria-label="定价厂商"
                >
                  <SelectValue>{listProvider === 'all' ? '全部厂商' : listProvider}</SelectValue>
                </SelectTrigger>
                <SelectContent className="pricing-list-provider-content" align="start">
                  <SelectGroup className="pricing-list-provider-options">
                    <SelectItem className="pricing-list-provider-option" value="all">
                      全部厂商
                    </SelectItem>
                    {listProviders.map((provider) => (
                      <SelectItem
                        className="pricing-list-provider-option"
                        value={provider}
                        key={provider}
                      >
                        {provider}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <InputGroup className="pricing-list-search min-w-36 flex-1">
                <InputGroupAddon className="pricing-list-search-icon" aria-hidden="true">
                  <Search className="pricing-list-search-svg" />
                </InputGroupAddon>
                <InputGroupInput
                  className="pricing-list-search-input"
                  aria-label="搜索已添加定价"
                  placeholder="搜索模型…"
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                />
                {listSearch && (
                  <InputGroupAddon className="pricing-list-search-actions" align="inline-end">
                    <Button
                      className="pricing-list-search-clear"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="清空定价搜索"
                      onClick={() => setListSearch('')}
                    >
                      <X className="pricing-list-search-clear-icon" aria-hidden="true" />
                    </Button>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <Button
                className="pricing-add-button"
                id="pricing-add"
                size="default"
                type="button"
                disabled={busy || loading}
                onClick={() => {
                  editorReturnFocus.current = 'pricing-add'
                  setEditing('new')
                }}
              >
                <Plus className="pricing-add-icon" data-icon="inline-start" aria-hidden="true" />
                新增定价
              </Button>
              <Button
                className="pricing-import-button"
                variant="outline"
                type="button"
                disabled={busy || loading}
                title="从 models.dev 导入"
                onClick={() => void fetchCatalog()}
              >
                <Download
                  className="pricing-import-icon"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                {busy ? '加载中…' : '导入'}
              </Button>
            </div>
            <div className="pricing-list min-h-0 flex-1 overflow-auto border-y" aria-busy={loading}>
              <table className="pricing-table w-full min-w-[36rem] table-fixed text-xs">
                <caption className="pricing-table-caption sr-only">
                  模型定价，单位为美元 / 百万 Token
                </caption>
                <thead className="pricing-table-head sticky top-0 bg-popover text-muted-foreground">
                  <tr className="pricing-table-head-row border-b">
                    <th
                      className="pricing-model-heading px-2 py-2 text-left font-normal"
                      scope="col"
                    >
                      模型
                    </th>
                    {modelPriceFields.slice(2).map(({ name, label }) => (
                      <th
                        className="pricing-rate-heading w-16 px-2 py-2 text-right font-normal"
                        scope="col"
                        key={name}
                      >
                        {label}
                      </th>
                    ))}
                    <th
                      className="pricing-actions-heading w-16 px-1 py-2 text-right font-normal"
                      scope="col"
                    >
                      <span className="pricing-actions-label sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="pricing-table-body">
                  {!loading &&
                    filteredPrices.map((item) => (
                      <tr
                        className="pricing-row border-b last:border-b-0 hover:bg-muted/40"
                        key={priceKey(item)}
                      >
                        <th
                          className="pricing-row-identity px-2 py-2 text-left font-normal"
                          scope="row"
                        >
                          <p
                            className="pricing-row-model truncate font-medium [unicode-bidi:plaintext]"
                            title={item.model}
                          >
                            {item.model}
                          </p>
                          <p
                            className="pricing-row-provider truncate text-muted-foreground"
                            title={item.provider}
                          >
                            {item.provider}
                          </p>
                        </th>
                        {modelPriceFields.slice(2).map(({ name }) => (
                          <td
                            className="pricing-row-rate truncate px-2 py-2 text-right tabular-nums"
                            title={item[name] === null ? '未设置' : String(item[name])}
                            key={name}
                          >
                            {item[name] === null ? (
                              <span
                                className="pricing-row-unset text-muted-foreground"
                                aria-label="未设置"
                              >
                                —
                              </span>
                            ) : (
                              item[name]
                            )}
                          </td>
                        ))}
                        <td className="pricing-row-actions px-1 py-2">
                          <div className="pricing-row-action-buttons flex justify-end">
                            <Button
                              className="pricing-edit-button"
                              id={`pricing-edit-${priceKey(item)}`}
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`编辑 ${item.model} 定价`}
                              disabled={busy}
                              onClick={() => {
                                editorReturnFocus.current = `pricing-edit-${priceKey(item)}`
                                setEditing(item)
                              }}
                            >
                              <Pencil className="pricing-edit-icon" aria-hidden="true" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="pricing-row-menu-trigger"
                                render={
                                  <Button
                                    className="pricing-row-menu-button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`${item.model} 的更多操作`}
                                    disabled={busy}
                                  />
                                }
                              >
                                <MoreHorizontal
                                  className="pricing-row-menu-icon"
                                  aria-hidden="true"
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="pricing-row-menu" align="end">
                                <DropdownMenuGroup className="pricing-row-menu-group">
                                  <DropdownMenuItem
                                    className="pricing-delete-button"
                                    variant="destructive"
                                    onClick={() => setDeleting(item)}
                                  >
                                    <Trash2 className="pricing-delete-icon" aria-hidden="true" />
                                    删除定价
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {(loading || !filteredPrices.length) && (
                <div className="pricing-list-empty flex min-h-36 flex-col items-center justify-center gap-3 py-8">
                  <p className="pricing-list-empty-text text-xs text-muted-foreground">
                    {loading
                      ? '正在读取定价…'
                      : prices.length
                        ? '没有匹配的模型'
                        : '还没有模型定价'}
                  </p>
                  {!loading && (listSearch || listProvider !== 'all') && (
                    <Button
                      className="pricing-list-reset"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setListSearch('')
                        setListProvider('all')
                      }}
                    >
                      重置筛选
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="pricing-list-footer flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="pricing-list-count tabular-nums">
                {loading
                  ? '读取中…'
                  : `共 ${filteredPrices.length} 项${filteredPrices.length !== prices.length ? ` / ${prices.length} 项` : ''}`}
              </span>
              <span className="pricing-list-unit">美元 / 百万 Token</span>
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
