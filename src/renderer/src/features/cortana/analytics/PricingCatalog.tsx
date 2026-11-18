import { useState } from 'react'
import { cn } from 'cn'
import { Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { unwrap } from '../../../../../shared/contracts'
import type { ModelPrice } from '../../../../../shared/usage-analytics'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage, priceKey, priceText } from './pricing-values'

const CATALOG_PAGE_SIZE = 100
type CatalogStatusFilter = 'all' | 'unadded' | 'unpriced'

// Keep catalog state in the dialog while its editor replaces the catalog view.
export function usePricingCatalog({
  prices,
  busy,
  setBusy,
  setError,
  onImported,
}: {
  prices: ModelPrice[]
  busy: boolean
  setBusy: (busy: boolean) => void
  setError: (error?: string) => void
  onImported: () => Promise<void>
}) {
  const [items, setItems] = useState<ModelPrice[]>()
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('all')
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function resetCatalogFilters() {
    setSearch('')
    setProviderFilter('all')
    setStatusFilter('all')
    setVisibleCount(CATALOG_PAGE_SIZE)
  }

  async function fetchCatalog() {
    setBusy(true)
    setError(undefined)
    try {
      setItems(unwrap(await window.desktop.usageAnalytics.fetchPrices()))
      setSelected(new Set())
      resetCatalogFilters()
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
    if (!items || !activeSelected.size || busy) return
    setBusy(true)
    try {
      const count = unwrap(
        await window.desktop.usageAnalytics.importPrices(
          items.filter((item) => activeSelected.has(priceKey(item))),
        ),
      )
      setItems(undefined)
      await onImported()
      toast.success(`已导入 ${count} 个模型定价。`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function closeCatalog() {
    setItems(undefined)
    setError(undefined)
  }

  return {
    fetchCatalog,
    catalog: items && {
      items,
      busy,
      closeCatalog,
      importSelected,
      resetCatalogFilters,
      existing,
      activeSelected,
      search,
      setSearch,
      providerFilter,
      setProviderFilter,
      statusFilter,
      setStatusFilter,
      visibleCount,
      setVisibleCount,
      setSelected,
    },
  }
}

export function PricingCatalog({
  catalog,
  unpricedModels,
  onEdit,
}: {
  catalog: NonNullable<ReturnType<typeof usePricingCatalog>['catalog']>
  unpricedModels: Pick<ModelPrice, 'provider' | 'model'>[]
  onEdit: (price: ModelPrice, triggerId: string) => void
}) {
  const {
    items,
    busy,
    closeCatalog,
    importSelected,
    resetCatalogFilters,
    existing,
    activeSelected,
    search,
    setSearch,
    providerFilter,
    setProviderFilter,
    statusFilter,
    setStatusFilter,
    visibleCount,
    setVisibleCount,
    setSelected,
  } = catalog
  const unpricedKeys = new Set(unpricedModels.map(priceKey))
  const providers = Array.from(new Set(items.map((item) => item.provider)))
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = items.filter((item) => {
    if (providerFilter !== 'all' && item.provider !== providerFilter) return false
    const id = priceKey(item)
    if (statusFilter === 'unadded' && existing.has(id)) return false
    if (statusFilter === 'unpriced' && !unpricedKeys.has(id)) return false
    if (!terms.length) return true
    const haystack = `${item.provider} ${item.model}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
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

  return (
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
            <SelectValue>{providerFilter === 'all' ? '全部厂商' : providerFilter}</SelectValue>
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
                    disabled={!!saved || busy || (activeSelected.size >= 500 && !selectedInBatch)}
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
                      <Badge className="pricing-catalog-added-badge shrink-0" variant="secondary">
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
                    onClick={() => onEdit(saved, editId)}
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
            onClick={closeCatalog}
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
  )
}
