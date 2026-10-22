import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import type { AccountOAuthProgress, AccountProduct } from '../../shared/accounts'
import { ACCOUNT_PRODUCTS } from '../../shared/accounts'
import {
  authFromToken,
  exchangeCode,
  GROK_CLIENT_ID,
  GROK_SCOPE,
  OAUTH_CONFIG,
  requestJSON,
} from './network'
import { text } from './files'

interface PendingOAuth {
  product: AccountProduct
  alias: string
  state: string
  verifier: string
  callback: string
  exchanging: boolean
  servers: Server[]
  abort: AbortController
  timeout?: ReturnType<typeof setTimeout>
  poll?: ReturnType<typeof setTimeout>
}

export class AccountOAuth {
  private pending?: PendingOAuth
  constructor(
    private readonly save: (
      product: AccountProduct,
      auth: Record<string, unknown>,
      alias: string,
    ) => Promise<void>,
    private readonly emit: (progress: AccountOAuthProgress) => void,
  ) {}

  async start(product: AccountProduct, alias: string): Promise<void> {
    if (this.pending) throw new Error('已有账号授权正在进行，请先完成或取消。')
    if (product === 'pi') throw new Error('请先在 Pi 中执行 /login，再导入当前登录。')
    const pending: PendingOAuth = {
      product,
      alias,
      state: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
      callback: '',
      exchanging: false,
      servers: [],
      abort: new AbortController(),
    }
    this.pending = pending
    pending.timeout = setTimeout(() => this.fail(pending, '授权已超时，请重新登录。'), 30 * 60000)
    pending.timeout.unref()
    try {
      if (product === 'grok') {
        await this.startDevice(pending)
        return
      }
      const config = OAUTH_CONFIG[product]
      const serve = () =>
        createServer((request, response) => {
          const url = new URL(request.url || '/', pending.callback)
          if (request.method !== 'GET' || url.pathname !== config.path) {
            response.writeHead(404).end()
            return
          }
          const state = Buffer.from(url.searchParams.get('state') || '')
          const expected = Buffer.from(pending.state)
          if (
            state.length !== expected.length ||
            !timingSafeEqual(state, expected) ||
            this.pending !== pending
          ) {
            response.writeHead(400).end('Invalid or expired authorization state.')
            return
          }
          if (pending.exchanging) {
            response.writeHead(409).end('Authorization is already being processed.')
            return
          }
          if (url.searchParams.has('error') || !url.searchParams.get('code')) {
            response.writeHead(400).end('Authorization was declined. You may return to Cota.')
            this.fail(pending, '浏览器授权未完成，请重新登录。')
            return
          }
          pending.exchanging = true
          this.emit({ product, stage: 'exchanging', message: '正在保存登录账号…' })
          response
            .writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
              'Content-Security-Policy': "default-src 'none'",
            })
            .end('已收到授权，请返回 Cota 查看结果。')
          void exchangeCode(
            product,
            url.searchParams.get('code')!,
            pending.state,
            pending.verifier,
            pending.callback,
          )
            .then((auth) => this.complete(pending, auth))
            .catch(() => this.fail(pending, '授权交换失败，请重新登录或检查网络。'))
        })
      const ipv4 = serve()
      pending.servers.push(ipv4)
      await new Promise<void>((resolve, reject) => {
        ipv4.once('error', reject)
        ipv4.listen(config.port, '127.0.0.1', () => {
          ipv4.removeListener('error', reject)
          resolve()
        })
      })
      const address = ipv4.address()
      if (!address || typeof address === 'string') throw new Error('无法监听本地授权回调。')
      pending.callback = `http://localhost:${address.port}${config.path}`
      const ipv6 = serve()
      pending.servers.push(ipv6)
      await new Promise<void>((resolve) => {
        ipv6.once('error', () => resolve())
        ipv6.listen({ port: address.port, host: '::1', ipv6Only: true }, resolve)
      })
      const authorize = new URL(config.authorize)
      const params: Record<string, string> = {
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: pending.callback,
        scope: config.scope,
        state: pending.state,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
      }
      if (product === 'codex')
        Object.assign(params, {
          id_token_add_organizations: 'true',
          codex_cli_simplified_flow: 'true',
          originator: 'codex_cli_rs',
        })
      if (product === 'claude') params.code = 'true'
      authorize.search = new URLSearchParams(params).toString()
      this.emit({
        product,
        stage: 'waiting',
        message: `请在浏览器中完成 ${ACCOUNT_PRODUCTS[product].name} 登录。`,
      })
      await shell.openExternal(authorize.href)
    } catch {
      if (this.pending === pending) {
        this.clear(pending)
        throw new Error('无法启动授权，请确认回调端口未被占用并检查网络。')
      }
    }
  }

  private async startDevice(pending: PendingOAuth): Promise<void> {
    const discovery = await requestJSON('https://auth.x.ai/.well-known/openid-configuration', {
      signal: pending.abort.signal,
    })
    const endpoint = text(discovery.device_authorization_endpoint)
    const tokenEndpoint = text(discovery.token_endpoint)
    // Discovery endpoints are never allowed to redirect tokens to another origin.
    if (
      new URL(endpoint).origin !== 'https://auth.x.ai' ||
      new URL(tokenEndpoint).origin !== 'https://auth.x.ai'
    )
      throw new Error('Grok 授权服务地址无效。')
    const device = await requestJSON(endpoint, {
      method: 'POST',
      signal: pending.abort.signal,
      body: new URLSearchParams({ client_id: GROK_CLIENT_ID, scope: GROK_SCOPE }),
    })
    const verification = new URL(
      text(device.verification_uri_complete) || text(device.verification_uri),
    )
    if (verification.origin !== 'https://auth.x.ai') throw new Error('Grok 授权地址无效。')
    this.emit({
      product: 'grok',
      stage: 'waiting',
      message: `请在浏览器中授权，验证码：${text(device.user_code)}`,
    })
    await shell.openExternal(verification.href)
    let interval = Math.max(5, Number(device.interval) || 5) * 1000
    const expires = Date.now() + Math.min(1800, Number(device.expires_in) || 1800) * 1000
    const poll = async () => {
      if (this.pending !== pending) return
      if (Date.now() > expires) {
        this.fail(pending, 'Grok 授权已超时。')
        return
      }
      try {
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          signal: AbortSignal.any([pending.abort.signal, AbortSignal.timeout(30000)]),
          redirect: 'error',
          body: new URLSearchParams({
            client_id: GROK_CLIENT_ID,
            device_code: text(device.device_code),
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        })
        const token = (await response.json()) as Record<string, unknown>
        if (this.pending !== pending) return
        if (response.ok) {
          pending.exchanging = true
          await this.complete(pending, await authFromToken('grok', token))
          return
        }
        if (token.error === 'slow_down') interval += 5000
        else if (token.error !== 'authorization_pending') {
          this.fail(pending, 'Grok 授权失败或已取消。')
          return
        }
      } catch {
        if (this.pending !== pending) return
        this.fail(pending, 'Grok 授权服务连接失败。')
        return
      }
      pending.poll = setTimeout(() => void poll(), interval)
      pending.poll.unref()
    }
    pending.poll = setTimeout(() => void poll(), interval)
    pending.poll.unref()
  }

  private async complete(pending: PendingOAuth, auth: Record<string, unknown>): Promise<void> {
    if (this.pending !== pending) return
    await this.save(pending.product, auth, pending.alias)
    if (this.pending !== pending) return
    this.clear(pending)
    this.emit({
      product: pending.product,
      stage: 'success',
      message: '账号已添加，可在列表中切换使用。',
    })
  }

  private fail(pending: PendingOAuth, message: string): void {
    if (this.pending !== pending) return
    this.clear(pending)
    this.emit({ product: pending.product, stage: 'error', message })
  }

  private clear(pending: PendingOAuth): void {
    if (this.pending === pending) this.pending = undefined
    pending.abort.abort()
    if (pending.timeout) clearTimeout(pending.timeout)
    if (pending.poll) clearTimeout(pending.poll)
    for (const server of pending.servers) {
      server.close()
      server.closeAllConnections()
    }
  }

  cancel(): void {
    const pending = this.pending
    if (!pending) return
    if (pending.exchanging) throw new Error('正在保存授权结果，请稍候。')
    this.clear(pending)
    this.emit({ product: pending.product, stage: 'cancelled', message: '授权已取消。' })
  }

  dispose(): void {
    if (this.pending) this.clear(this.pending)
  }
}
