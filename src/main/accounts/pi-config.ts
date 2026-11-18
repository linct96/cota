import { z } from 'zod'
import {
  OPENAI_API_URL,
  apiBaseUrlSchema,
  piApiSchema,
  piProviderIdSchema,
} from '../../shared/accounts'
import { object } from './files'

export const PI_DEFAULT_URLS = new Map([
  ['openai', OPENAI_API_URL],
  ['openai-codex', 'https://chatgpt.com/backend-api'],
])
const modelSchema = z
  .object({ id: z.string().min(1).max(200), api: piApiSchema.optional() })
  .passthrough()
const configSchema = z
  .object({
    name: z.string().max(200).optional(),
    baseUrl: apiBaseUrlSchema.optional(),
    api: piApiSchema.optional(),
    models: z.array(modelSchema).min(1).max(1000).optional(),
  })
  .passthrough()

export function piProviderConfig(raw: unknown, provider: string): Record<string, unknown> {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw)))
    throw new Error('Pi Provider 配置必须是 JSON 对象。')
  const result = configSchema.safeParse(raw ?? {})
  if (!result.success) throw new Error('Pi Provider 的地址、协议或模型配置无效。')
  const config: Record<string, unknown> = { ...result.data }
  if (
    config.headers !== undefined ||
    config.oauth !== undefined ||
    [...(result.data.models ?? []), ...Object.values(object(config.modelOverrides))].some(
      (model) => object(model).headers !== undefined || object(model).baseUrl !== undefined,
    )
  )
    throw new Error(
      '暂不支持带自定义请求头、模型级地址或自定义 OAuth 的 Pi Provider，请先在 Pi 中处理。',
    )
  // Keys are stored only in auth.json; never leave a fallback key in models.json.
  delete config.apiKey
  if (!PI_DEFAULT_URLS.has(provider) && provider !== 'xai') {
    if (
      !piProviderIdSchema.safeParse(provider).success ||
      !config.baseUrl ||
      !result.data.api ||
      !result.data.models?.length
    )
      throw new Error('自定义 Provider 需要独立 ID、API 地址、协议和模型 ID。')
  }
  if (typeof config.baseUrl === 'string') {
    config.baseUrl = new URL(config.baseUrl).href.replace(/\/+$/, '')
    if (config.baseUrl === PI_DEFAULT_URLS.get(provider)) delete config.baseUrl
  }
  return config
}

export function savedPiConfig(
  auth: Record<string, unknown>,
  provider: string,
): Record<string, unknown> {
  return piProviderConfig(object(auth.$cota).providerConfig, provider)
}

export function piConfigMetadata(config: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(config).length ? { $cota: { providerConfig: config } } : {}
}

export function stablePiConfig(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      )
    return item
  }
  return JSON.stringify(canonical(value))
}
