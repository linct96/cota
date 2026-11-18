import { useCallback, useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { cn } from 'cn'
import { Download, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const priceKey = (item: Pick<ModelPrice, 'provider' | 'model'>) =>
  JSON.stringify([item.provider.toLowerCase(), item.model.toLowerCase()])
const priceText = (value: number | null) => (value === null ? '—' : `$${value}`)
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法处理模型定价。'

const CATALOG_PAGE_SIZE = 100
type CatalogStatusFilter = 'all' | 'unadded' | 'unpriced'

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
  const [catalog, setCatalog] = useState<ModelPrice[]>()
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('all')
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [listProvider, setListProvider] = useState('all')
  const editorReturnFocus = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (editing) {
      document.getElementById(editing === 'new' ? 'price-provider' : 'price-input')?.focus()
    } else if (editorReturnFocus.current) {
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
  async function fetchCatalog() {
    setBusy(true)
    setError(undefined)
    try {
      setCatalog(unwrap(await window.desktop.usageAnalytics.fetchPrices()))
      setSelected(new Set())
      setSearch('')
      setProviderFilter('all')
      setStatusFilter('all')
      setVisibleCount(CATALOG_PAGE_SIZE)
    } catch {
      toast.error('无法加载模型定价，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }
  const existing = new Map(prices.map((item) => [priceKey(item), item]))
  // 已存在的模型不参与勾选、上限统计和导入
  const activeSelected = new Set(Array.from(selected).filter((id) => !existing.has(id)))

  async function importSelected() {
    if (!catalog || !activeSelected.size || busy) return
    setBusy(true)
    try {
      const count = unwrap(
        await window.desktop.usageAnalytics.importPrices(
          catalog.filter((item) => activeSelected.has(priceKey(item))),
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
  const unpricedKeys = new Set(unpricedModels.map(priceKey))
  const providers = catalog ? Array.from(new Set(catalog.map((item) => item.provider))) : []
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches =
    catalog?.filter((item) => {
      if (providerFilter !== 'all' && item.provider !== providerFilter) return false
      const id = priceKey(item)
      if (statusFilter === 'unadded' && existing.has(id)) return false
      if (statusFilter === 'unpriced' && !unpricedKeys.has(id)) return false
      if (!terms.length) return true
      const haystack = `${item.provider} ${item.model}`.toLowerCase()
      return terms.every((term) => haystack.includes(term))
    }) ?? []
  const selectableMatches = matches.filter((item) => !existing.has(priceKey(item)))
  const selectedInViewCount = selectableMatches.filter((item) =>
    activeSelected.has(priceKey(item)),
  ).length
  const allSelectableChecked =
    selectableMatches.length > 0 && selectedInViewCount === selectableMatches.length
  const someSelectableChecked = selectedInViewCount > 0 && !allSelectableChecked
  const hasActiveFilter =
    Boolean(search.trim()) || providerFilter !== 'all' || statusFilter !== 'all'

  function toggleSelectAllMatches() {
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((id) => !existing.has(id)))
      if (allSelectableChecked) {
        for (const item of selectableMatches) {
          next.delete(priceKey(item))
        }
      } else {
        for (const item of selectableMatches) {
          if (next.size >= 500) break
          next.add(priceKey(item))
        }
      }
      return next
    })
  }

  function resetCatalogFilters() {
    setSearch('')
    setProviderFilter('all')
    setStatusFilter('all')
    setVisibleCount(CATALOG_PAGE_SIZE)
  }

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
          <>
            <div className="pricing-catalog-filters flex flex-wrap items-center gap-2">
              <Select
                value={providerFilter}
                onValueChange={(value) => {
                  if (!value) return
                  setProviderFilter(value)
                  setVisibleCount(CATALOG_PAGE_SIZE)
                }}
              >
                <SelectTrigger className="pricing-provider-trigger w-32 shrink-0" aria-label="厂商">
                  <SelectValue>
                    {providerFilter === 'all' ? '全部厂商' : providerFilter}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="pricing-provider-content" align="start">
                  <SelectItem className="pricing-provider-item" value="all">
                    全部厂商
                  </SelectItem>
                  {providers.map((provider) => (
                    <SelectItem className="pricing-provider-item" key={provider} value={provider}>
                      {provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="pricing-search-wrapper relative min-w-44 flex-1">
                <Search
                  className="pricing-search-icon pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  className="pricing-search-input pr-7 pl-8"
                  id="pricing-search"
                  aria-label="搜索模型"
                  placeholder="搜索模型名称…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setVisibleCount(CATALOG_PAGE_SIZE)
                  }}
                />
                {search && (
                  <Button
                    className="pricing-search-clear absolute top-1/2 right-1 size-5 -translate-y-1/2"
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => {
                      setSearch('')
                      setVisibleCount(CATALOG_PAGE_SIZE)
                    }}
                  >
                    <X className="pricing-search-clear-icon size-3" aria-hidden="true" />
                  </Button>
                )}
              </div>
              <ToggleGroup
                className="pricing-status-filter grid auto-cols-fr grid-flow-col shrink-0"
                variant="segmented"
                spacing={1}
                aria-label="模型定价状态"
                value={[statusFilter]}
                onValueChange={(values) => {
                  const next = values.at(-1) as CatalogStatusFilter | undefined
                  if (!next) return
                  setStatusFilter(next)
                  setVisibleCount(CATALOG_PAGE_SIZE)
                }}
              >
                <ToggleGroupItem className="pricing-status-option" value="all">
                  全部
                </ToggleGroupItem>
                <ToggleGroupItem className="pricing-status-option" value="unadded">
                  未添加
                </ToggleGroupItem>
                {(unpricedKeys.size > 0 || statusFilter === 'unpriced') && (
                  <ToggleGroupItem className="pricing-status-option" value="unpriced">
                    未定价
                  </ToggleGroupItem>
                )}
              </ToggleGroup>
            </div>
            <div className="pricing-catalog-panel flex min-h-0 flex-1 flex-col border-y">
              <div className="pricing-catalog-header flex items-center justify-between border-b bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                <span className="pricing-catalog-count tabular-nums">
                  共 {matches.length} 项{activeSelected.size >= 500 ? ' · 已达单次上限 500' : ''}
                </span>
                <span className="pricing-catalog-unit">输入 / 输出（$/M）</span>
              </div>
              <div className="pricing-catalog-list min-h-0 flex-1 overflow-y-auto">
                {matches.slice(0, visibleCount).map((item) => {
                  const id = priceKey(item)
                  const saved = existing.get(id)
                  const selectedInBatch = activeSelected.has(id)
                  const editId = `pricing-catalog-edit-${id}`
                  return (
                    <div
                      className="pricing-catalog-row flex items-center gap-2 border-b px-2 py-2 last:border-b-0"
                      key={id}
                    >
                      <label className="pricing-catalog-option flex min-w-0 flex-1 cursor-pointer items-center gap-3 has-data-disabled:cursor-not-allowed">
                        <Checkbox
                          className="pricing-catalog-checkbox"
                          checked={!!saved || selectedInBatch}
                          disabled={
                            !!saved || busy || (activeSelected.size >= 500 && !selectedInBatch)
                          }
                          onCheckedChange={(nextChecked) => {
                            if (saved) return
                            setSelected((current) => {
                              const next = new Set(current)
                              if (nextChecked) next.add(id)
                              else next.delete(id)
                              return next
                            })
                          }}
                        />
                        <span className="pricing-catalog-model-info flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className={cn(
                              'pricing-catalog-model min-w-0 truncate',
                              saved && 'text-muted-foreground',
                            )}
                            title={`${item.provider} / ${item.model}`}
                          >
                            {item.provider} / {item.model}
                          </span>
                          {saved && (
                            <Badge
                              className="pricing-catalog-added-badge shrink-0"
                              variant="secondary"
                            >
                              已添加
                            </Badge>
                          )}
                        </span>
                        <span className="pricing-catalog-price shrink-0 text-xs text-muted-foreground tabular-nums">
                          {`${priceText(item.input)} / ${priceText(item.output)}`}
                        </span>
                      </label>
                      {saved && unpricedKeys.has(id) && (
                        <Button
                          className="pricing-catalog-edit shrink-0"
                          id={editId}
                          variant="ghost"
                          size="sm"
                          type="button"
                          disabled={busy}
                          aria-label={`编辑 ${item.provider} / ${item.model} 定价`}
                          onClick={() => {
                            editorReturnFocus.current = editId
                            setEditing(saved)
                          }}
                        >
                          编辑
                        </Button>
                      )}
                    </div>
                  )
                })}
                {!matches.length && (
                  <div className="pricing-catalog-empty flex flex-col items-center gap-2 py-8 text-center">
                    <p className="pricing-catalog-empty-text text-sm text-muted-foreground">
                      没有匹配的模型
                    </p>
                    {hasActiveFilter && (
                      <Button
                        className="pricing-catalog-reset"
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={resetCatalogFilters}
                      >
                        重置筛选
                      </Button>
                    )}
                  </div>
                )}
                {matches.length > visibleCount && (
                  <div className="pricing-catalog-more flex justify-center py-2">
                    <Button
                      className="pricing-catalog-more-button tabular-nums"
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setVisibleCount((count) => count + CATALOG_PAGE_SIZE)}
                    >
                      显示更多（剩余 {matches.length - visibleCount} 项）
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter className="pricing-catalog-footer sm:items-center sm:justify-between">
              <div className="pricing-catalog-bulk flex items-center">
                <label
                  className="pricing-catalog-select-all flex h-7 cursor-pointer items-center gap-3 px-2 text-xs select-none has-disabled:cursor-not-allowed has-disabled:opacity-50"
                  htmlFor="pricing-catalog-select-all"
                >
                  <Checkbox
                    className="pricing-catalog-select-all-checkbox"
                    id="pricing-catalog-select-all"
                    checked={allSelectableChecked}
                    indeterminate={someSelectableChecked}
                    disabled={
                      busy ||
                      !selectableMatches.length ||
                      (!allSelectableChecked && activeSelected.size >= 500)
                    }
                    onCheckedChange={toggleSelectAllMatches}
                  />
                  <span className="pricing-catalog-select-all-label">
                    {allSelectableChecked ? '取消全选' : '全选'}
                  </span>
                </label>
              </div>
              <div className="pricing-catalog-actions flex items-center gap-2">
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
                  className="pricing-catalog-import tabular-nums"
                  type="button"
                  disabled={busy || !activeSelected.size}
                  onClick={() => void importSelected()}
                >
                  导入{activeSelected.size ? ` (${activeSelected.size})` : ''}
                </Button>
              </div>
            </DialogFooter>
          </>
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
                    {fields.slice(2).map(({ name, label }) => (
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
                        {fields.slice(2).map(({ name }) => (
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
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: formSchema },
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
  const renderField = ({ name, label }: (typeof fields)[number]) => {
    const identity = name === 'provider' || name === 'model'
    return (
      <form.Field name={name} key={name}>
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field
              className="pricing-editor-field"
              data-invalid={invalid}
              data-disabled={!!price && identity}
            >
              <FieldLabel className="pricing-editor-label" htmlFor={`price-${name}`}>
                {label}
              </FieldLabel>
              <Input
                className={cn('pricing-editor-input', !identity && 'tabular-nums')}
                id={`price-${name}`}
                name={name}
                value={field.state.value}
                placeholder={
                  name === 'provider' ? '例如 openai' : name === 'model' ? '例如 gpt-5.4' : '未设置'
                }
                required={identity}
                disabled={!!price && identity}
                inputMode={identity ? 'text' : 'decimal'}
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
    )
  }
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
      <FieldGroup className="pricing-editor-fields min-h-0 gap-5 overflow-y-auto">
        <FieldGroup className="pricing-editor-identity gap-3">
          {fields.slice(0, 2).map(renderField)}
        </FieldGroup>
        <fieldset className="pricing-editor-rates min-w-0">
          <legend className="pricing-editor-rates-legend mb-3 w-full">
            <span className="pricing-editor-rates-heading flex flex-wrap items-center justify-between gap-2">
              <span className="pricing-editor-rates-title font-medium">Token 单价</span>
              <span className="pricing-editor-unit text-muted-foreground">美元 / 百万 Token</span>
            </span>
          </legend>
          <FieldGroup className="pricing-editor-rate-fields grid grid-cols-2 gap-3">
            {fields.slice(2).map(renderField)}
          </FieldGroup>
        </fieldset>
      </FieldGroup>
      <DialogFooter className="pricing-editor-footer">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, submitting]) => (
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
              <Button
                className="pricing-editor-save"
                type="submit"
                disabled={!canSubmit || submitting}
              >
                {submitting ? '保存中…' : '保存'}
              </Button>
            </>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
