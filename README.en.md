# dsh-auto-retry

English | [中文](README.md)

Automatic retry for model requests in DeepSeek Harness. When a step fails because a gateway hiccuped, rate-limited the call, or timed out, the plugin intercepts that failure, waits, and replays the same step instead of ending the turn.

```
provider answers 503 / 429 / "upstream_error" …
        ↓  agent/request-error waterfall
   dsh-auto-retry (prepended, sees the failure first)
        ↓  wait 2s → retry; fail again, wait 5s → retry …
   the same step runs again
```

## What it is for

Proxy gateways, aggregators and rate-limited endpoints tend to fail **once**: the same request a few seconds later succeeds. The stock behaviour surfaces the error, ends the turn, and asks you to send the message again.

With this plugin installed those blips are absorbed in place. The log shows `retry 1/4, waiting 2s`, and the conversation carries on by itself.

## Install

```powershell
dsh plugin add github:643048695/dsh-auto-retry
```

Or add it to the profile's `package.json` dependencies, list `dsh-auto-retry` in `dsh.profile.bundles`, and link the directory into `node_modules`.

## Backoff ladder

Four attempts by default, at most ≈37 seconds of silence in total:

| Attempt | Wait | Cumulative |
| --- | --- | --- |
| 1 | 2s | 2s |
| 2 | 5s | 7s |
| 3 | 10s | 17s |
| 4 | 20s | 37s |

Counters are keyed by **provider + turn + step**, so a retry replays that one step — it never restarts the whole turn.

## Configuration

Editable from the settings page; every field is `volatile`, so changes take effect immediately without a restart.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `maxRetries` | `4` | Retry cap; past the end of the ladder the last delay (20s) is reused |
| `log` | `true` | Whether to log each interception and wait |

## Boundaries and trade-offs

- **Every error is retried; nothing is classified.** That is deliberate: proxies routinely report quota exhaustion or an unknown model as a bare `upstream_error` with no status code, so status-code filtering misses exactly the cases this plugin exists for. The price is that **unrecoverable errors are retried too** (an invalid key, a malformed body), which shows up as a few dozen seconds of waiting before the same error appears. Lower `maxRetries` or disable the plugin if you would rather fail fast.
- **A user stop (`signal.aborted`) abandons the retry immediately** — no retry keeps running in the background.
- **Only the current step is replayed.** The request body is not rewritten, and neither the model nor the provider is changed; that is the job of routing plugins.
- When retries are exhausted the log says so explicitly (`reached the retry cap, stopping`) instead of swallowing the failure.

## Compatibility

- Depends on the host's `agent/request-error` waterfall and on a handler returning `{ kind: "retry" }`.
- Checked against DSH **0.2.1-rc.3** (the core bundled with the current desktop build): both seams and the return contract are present. The 0.1.7 line has them as well.
- If the host ever changes either contract, the worst case is that the plugin **does nothing** — it cannot make an otherwise working request fail.

## Verification

`npm test` runs eight cases covering the growing ladder, the fall-through once the cap is reached, counter isolation per step, the disabled switch, and both abort paths (already-aborted and aborted mid-wait). They drive `node:test` mock timers, so the suite does not actually sit through 37 seconds. CI additionally checks the manifest the market requires and that every entry file exists.

## License

MIT. See [LICENSE](LICENSE).
