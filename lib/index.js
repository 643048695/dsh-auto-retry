/**
 * dsh-auto-retry
 *
 * 全错误捕获与多轮阶梯退避自动重试插件。
 * 针对各类模型提供方返回的 503, 502, 500, 429, 超时, 断网, 以及第三方网关常见但未带状态码的
 * "The service is busy", "upstream_error", "overloaded" 等所有错误进行智能拦截与恢复。
 *
 * 阶梯退避策略（共最多 4 次，最坏累计静默 37 秒）：
 * 第 1 次：2 秒 (2,000 ms)
 * 第 2 次：5 秒 (5,000 ms)
 * 第 3 次：10 秒 (10,000 ms)
 * 第 4 次：20 秒 (20,000 ms)
 *
 * @module dsh-auto-retry
 */
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-auto-retry'
export const inject = []

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用智能全错误自动重试。')
    .volatile(),
  maxRetries: Schema.number()
    .default(4)
    .description('最大重试次数上限（默认 4 次）。')
    .volatile(),
  log: Schema.boolean()
    .default(true)
    .description('在控制台/日志中输出重试与等待信息。')
    .volatile()
})

const LADDER_DELAYS = [2000, 5000, 10000, 20000]

/** 记录各会话步骤已重试次数的内存表: sessionKey -> count */
const retryCounters = new Map()

function getStepKey(payload) {
  const turn = payload.turn ?? '0'
  const step = payload.step ?? '0'
  const provider = payload.provider ?? 'unknown'
  return `${provider}:${turn}:${step}`
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve(true)
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let timer
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function apply(ctx, config) {
  const settings = config ?? {}

  function isEnabled() {
    const v = settings.enabled
    if (v === undefined || v === null) return true
    if (typeof v === 'object' && typeof v.get === 'function') return v.get() !== false
    return v !== false
  }

  function getMaxRetries() {
    const v = settings.maxRetries
    if (v === undefined || v === null) return 4
    if (typeof v === 'object' && typeof v.get === 'function') return Number(v.get()) || 4
    return Number(v) || 4
  }

  function shouldLog() {
    const v = settings.log
    if (v === undefined || v === null) return true
    if (typeof v === 'object' && typeof v.get === 'function') return v.get() !== false
    return v !== false
  }

  ctx.on('agent/request-error', async (payload, next) => {
    if (!isEnabled()) return next()

    const signal = payload.signal
    if (signal?.aborted) return next()

    const maxRetries = getMaxRetries()
    const stepKey = getStepKey(payload)
    const currentRetry = (retryCounters.get(stepKey) ?? 0) + 1

    if (currentRetry > maxRetries) {
      retryCounters.delete(stepKey)
      if (shouldLog()) {
        ctx.logger?.warn?.(`[dsh-auto-retry] ${stepKey} 已达到最大重试次数 (${maxRetries})，停止重试`)
      }
      return next()
    }

    retryCounters.set(stepKey, currentRetry)

    // 计算阶梯延迟时间
    const ladderIndex = Math.min(currentRetry - 1, LADDER_DELAYS.length - 1)
    const delayMs = LADDER_DELAYS[ladderIndex]

    const failureMsg = payload.failure?.message ?? payload.failure?.code ?? 'Request Error'

    if (shouldLog()) {
      ctx.logger?.info?.(
        `[dsh-auto-retry] 捕获到模型请求异常: "${failureMsg}"，正在执行第 ${currentRetry}/${maxRetries} 次自动重试，等待 ${delayMs / 1000} 秒...`
      )
      console.warn(
        `[dsh-auto-retry] 捕获到模型请求异常: "${failureMsg}"，正在执行第 ${currentRetry}/${maxRetries} 次自动重试，等待 ${delayMs / 1000} 秒...`
      )
    }

    const waitOk = await sleep(delayMs, signal)
    if (!waitOk || signal?.aborted) {
      retryCounters.delete(stepKey)
      return
    }

    if (shouldLog()) {
      ctx.logger?.info?.(`[dsh-auto-retry] 等待结束，立即触发第 ${currentRetry} 次重试尝试`)
      console.log(`[dsh-auto-retry] 等待结束，立即触发第 ${currentRetry} 次重试尝试`)
    }

    return { kind: 'retry' }
  }, { prepend: true })

  ctx.logger?.info?.('[dsh-auto-retry] 智能全错误自动重试插件已挂载 (prepend waterfall)')
  console.log('[dsh-auto-retry] 智能全错误自动重试插件已挂载成功')
}
