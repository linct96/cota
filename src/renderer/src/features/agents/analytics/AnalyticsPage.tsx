import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { LoaderCircle, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { unwrap } from '../../../../../shared/contracts'
import type { UsageAnalytics, UsageRange } from '../../../../../shared/usage-analytics'
import { useAgents } from '@/features/agents/agents-store'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PricingDialog } from './PricingDialog'

const ranges: { value: UsageRange; label: string }[] = [
  { value: 'today', label: '当天' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
]
const number = new Intl.NumberFormat('zh-CN')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})
const chartConfig = { total: { label: 'Token', color: 'var(--foreground)' } } satisfies ChartConfig
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '无法读取统计数据。'
const formatCost = (cost: number | null, missing: number) =>
  cost === null ? '—' : `${missing ? '≥ ' : ''}${currency.format(cost)}`

export function AnalyticsPage() {
  const product = useAgents((state) => state.activeProduct)
  const [range, setRange] = useState<UsageRange>('today')
  const [result, setResult] = useState<{
    product: string
    range: UsageRange
    revision: number
    data?: UsageAnalytics
    error?: string
  }>()
  const [pricingOpen, setPricingOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const current =
    result?.product === product && result.range === range && result.revision === revision
      ? result
      : undefined
  const loading = !current
  const analytics = current?.data
  const error = current?.error

  useEffect(() => {
    let cancelled = false
    async function query() {
      try {
        const data = unwrap(await window.desktop.usageAnalytics.query(product, range))
        if (!cancelled) setResult({ product, range, revision, data })
      } catch (caught) {
        if (!cancelled) setResult({ product, range, revision, error: errorMessage(caught) })
      }
    }
    void query()
    return () => {
      cancelled = true
    }
  }, [product, range, revision])

  return (
    <section className="analytics-page flex min-h-0 flex-1 flex-col" aria-label="统计分析">
      <header className="analytics-header flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h2 className="analytics-title text-lg font-semibold">统计分析</h2>
        <div className="analytics-actions flex flex-wrap items-center gap-2">
          <ToggleGroup
            className="analytics-range"
            value={[range]}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="统计时间范围"
            onValueChange={(values) => {
              const next = values[0] as UsageRange | undefined
              if (next) setRange(next)
            }}
          >
            {ranges.map((item) => (
              <ToggleGroupItem
                className="analytics-range-option"
                key={item.value}
                value={item.value}
              >
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            className="analytics-pricing-button"
            variant="outline"
            size="sm"
            onClick={() => setPricingOpen(true)}
          >
            <SlidersHorizontal
              className="analytics-pricing-icon"
              data-icon="inline-start"
              aria-hidden="true"
            />
            模型定价
          </Button>
          <Button
            className="analytics-refresh-button"
            variant="ghost"
            size="icon-sm"
            aria-label="刷新统计"
            title="刷新统计"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw className="analytics-refresh-icon" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div
        className="analytics-scroll-area flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-1 pb-5"
        aria-busy={loading}
      >
        {error && (
          <Alert className="analytics-error" variant="destructive">
            <AlertDescription className="analytics-error-message">{error}</AlertDescription>
          </Alert>
        )}
        {loading && !analytics ? (
          <output
            className="analytics-loading grid min-h-60 place-items-center"
            aria-label="正在读取统计"
          >
            <LoaderCircle className="analytics-loading-icon animate-spin" aria-hidden="true" />
          </output>
        ) : analytics ? (
          <AnalyticsContent analytics={analytics} range={range} />
        ) : null}
      </div>
      {pricingOpen && (
        <PricingDialog
          unpricedModels={
            result?.product === product && result.range === range
              ? result.data?.models.filter((item) => item.unpricedRecords > 0)
              : undefined
          }
          onClose={() => setPricingOpen(false)}
          onChanged={() => setRevision((value) => value + 1)}
        />
      )}
    </section>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="analytics-metric" size="sm">
      <CardHeader className="analytics-metric-header">
        <CardTitle className="analytics-metric-title">{label}</CardTitle>
      </CardHeader>
      <CardContent className="analytics-metric-content">
        <strong
          className="analytics-metric-value text-2xl font-semibold tabular-nums"
          title={value}
        >
          {value}
        </strong>
        {detail && (
          <p className="analytics-metric-detail mt-2 text-xs text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}

function AnalyticsContent({ analytics, range }: { analytics: UsageAnalytics; range: UsageRange }) {
  const { total } = analytics
  const cacheRate =
    total.cacheRead === null || !total.input
      ? '—'
      : `${((total.cacheRead / total.input) * 100).toFixed(1)}%`
  const warning = analytics.skippedFiles + analytics.skippedRecords
  return (
    <div className="analytics-content flex flex-col gap-7">
      {warning > 0 && (
        <Alert className="analytics-partial">
          <AlertDescription className="analytics-partial-message">
            部分记录未统计：
            {analytics.skippedFiles > 0
              ? `${number.format(analytics.skippedFiles)} 个文件或目录无法读取`
              : ''}
            {analytics.skippedFiles > 0 && analytics.skippedRecords > 0 ? '，' : ''}
            {analytics.skippedRecords > 0
              ? `${number.format(analytics.skippedRecords)} 条记录无法解析`
              : ''}
            。
          </AlertDescription>
        </Alert>
      )}
      <section
        className="analytics-overview grid gap-3 sm:grid-cols-2 min-[60rem]:grid-cols-4"
        aria-label="用量概览"
      >
        <Metric
          label="预估费用"
          value={formatCost(analytics.estimatedCost, analytics.unpricedRecords)}
          detail={analytics.unpricedRecords ? '部分用量未定价' : undefined}
        />
        <Metric
          label="总 Token"
          value={compact.format(total.total)}
          detail={number.format(total.total)}
        />
        <Metric
          label="输入 Token"
          value={compact.format(total.input)}
          detail={`缓存命中率 ${cacheRate}`}
        />
        <Metric
          label="输出 Token"
          value={compact.format(total.output)}
          detail={`推理输出 ${total.reasoning === null ? '—' : number.format(total.reasoning)}`}
        />
      </section>
      <section className="analytics-trend-section" aria-labelledby="analytics-trend-title">
        <div className="analytics-section-header flex items-baseline justify-between gap-3">
          <h3
            className="analytics-section-title text-base font-semibold"
            id="analytics-trend-title"
          >
            Token 趋势
          </h3>
          <span className="analytics-trend-interval text-xs text-muted-foreground">
            {range === 'today' ? '按小时' : range === 'all' ? '按月' : '按天'}
          </span>
        </div>
        {total.total ? (
          <ChartContainer
            className="analytics-chart mt-4 aspect-auto h-56 w-full"
            config={chartConfig}
          >
            <AreaChart accessibilityLayer data={analytics.trend} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
              />
              <YAxis
                dataKey="total"
                domain={[0, 'auto']}
                allowDecimals={false}
                tickFormatter={(value: number) => compact.format(value)}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width="auto"
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="total"
                type="monotoneX"
                fill="var(--color-total)"
                fillOpacity={0.1}
                stroke="var(--color-total)"
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <Empty className="analytics-trend-empty mt-4 min-h-32 border-y">
            <EmptyHeader className="analytics-empty-header">
              <EmptyTitle className="analytics-empty-title">当前范围内暂无 Token 记录</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </section>
      <section className="analytics-model-section" aria-labelledby="analytics-model-title">
        <h3 className="analytics-section-title text-base font-semibold" id="analytics-model-title">
          模型用量
        </h3>
        {analytics.models.length ? (
          <div className="analytics-model-list mt-4 border-y">
            {analytics.models.map((model) => {
              const share = total.total ? (model.tokens.total / total.total) * 100 : 0
              const details = [
                ['输入', model.tokens.input],
                ['缓存读取', model.tokens.cacheRead],
                ['缓存写入', model.tokens.cacheWrite],
                ['输出', model.tokens.output],
                ['推理输出', model.tokens.reasoning],
                ['会话', model.sessionCount],
                ['轮次', model.turnCount],
              ] as const
              return (
                <article
                  className="analytics-model-row flex flex-col gap-3 border-b py-4 last:border-b-0"
                  key={`${model.provider}:${model.model}`}
                >
                  <div className="analytics-model-heading flex flex-wrap items-baseline justify-between gap-2">
                    <strong
                      className="analytics-model-name min-w-0 truncate text-sm"
                      title={model.model}
                    >
                      {model.model}
                      {model.provider && (
                        <span className="analytics-model-provider ml-2 font-normal text-muted-foreground">
                          {model.provider}
                        </span>
                      )}
                    </strong>
                    <div className="analytics-model-totals flex items-baseline gap-4 tabular-nums">
                      <span
                        className="analytics-model-cost text-muted-foreground"
                        title={model.unpricedRecords ? '部分用量未定价' : '预估费用'}
                      >
                        {formatCost(model.estimatedCost, model.unpricedRecords)}
                      </span>
                      <span className="analytics-model-tokens font-semibold">
                        {number.format(model.tokens.total)} Token
                      </span>
                    </div>
                  </div>
                  <progress
                    className="analytics-model-share h-1 w-full accent-foreground"
                    max={100}
                    value={Math.min(share, 100)}
                    aria-label={`${model.model} 占比 ${share.toFixed(1)}%`}
                  />
                  <dl className="analytics-model-details grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 xl:grid-cols-7">
                    {details.map(([label, value]) => (
                      <div className="analytics-model-detail min-w-0" key={label}>
                        <dt className="analytics-model-detail-label text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="analytics-model-detail-value mt-1 truncate tabular-nums">
                          {value === null ? '—' : number.format(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              )
            })}
          </div>
        ) : (
          <Empty className="analytics-model-empty mt-4 min-h-32 border-y">
            <EmptyHeader className="analytics-empty-header">
              <EmptyTitle className="analytics-empty-title">当前范围内暂无模型用量</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}
