# 更新日志

[English](CHANGELOG.md) | 中文

## [1.0.0] — 2026-10-29

首个公开版本。

### 新增

- **宿主半边（`lib/index.js`）** — 监听 `agent/request-error` waterfall，`{ prepend: true }` 注册，因此比任何其他恢复层都先拿到失败。等待一段时间后返回 `{ kind: "retry" }`，让同一个 step 重跑。
- **四段退避阶梯** — 2 / 5 / 10 / 20 秒，最坏累计约 37 秒。计数按 `provider + turn + step` 为键，只重放失败的那一个 step。
- **可中断** — 等待前或等待中收到 `signal.aborted` 就放弃，而不是睡满。
- **配置项** — 三个 `volatile` 字段（`enabled`、`maxRetries`、`log`），设置页改完立即生效。
- **次数耗尽时明确写日志** — 达到上限时说明「停止重试」，不静默吞错。

### 说明

- 重试**不按状态码分类**，一律重试：中转站经常把额度不足、模型不存在包成一句 `upstream_error`。代价写在 README 里。
