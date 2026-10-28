import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, name } from "../lib/index.js";

/**
 * Minimal cordis-ish context: records waterfall listeners, provides a logger.
 * The plugin keeps its retry counters in module scope, so every test builds its
 * own provider name — otherwise a previous test's counter would shift the ladder.
 */
function makeCtx() {
  const listeners = [];
  const logs = [];
  return {
    ctx: {
      on(event, handler, options) {
        listeners.push({ event, handler, options });
      },
      logger: {
        info: (m) => logs.push(["info", String(m)]),
        warn: (m) => logs.push(["warn", String(m)]),
      },
    },
    logs,
    fire: (payload) => listeners[0].handler(payload, () => "native"),
  };
}

let providers = 0;
function payload(overrides = {}) {
  return {
    provider: `demo-${++providers}`,
    turn: 1,
    step: 0,
    failure: { code: "UPSTREAM_ERROR", message: "upstream_error" },
    ...overrides,
  };
}

test("plugin declares its module name and registers one prepended listener", () => {
  assert.equal(name, "dsh-auto-retry");
  const listeners = [];
  const fake = { on: (event, handler, options) => listeners.push({ event, options }) };
  apply(fake, {});
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].event, "agent/request-error");
  assert.equal(listeners[0].options?.prepend, true);
});

test("waits the first ladder step then asks the host to retry the same step", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, fire } = makeCtx();
  apply(ctx, { log: false });
  const p = payload();

  const pending = fire(p);
  let settled = false;
  pending.then(() => (settled = true));

  t.mock.timers.tick(1999);
  await Promise.resolve();
  assert.equal(settled, false, "must not retry before the 2s ladder step elapses");

  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { kind: "retry" });
});

test("ladder grows: the second failure waits 5s, not 2s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, fire } = makeCtx();
  apply(ctx, { log: false });
  const p = payload();

  const first = fire(p);
  t.mock.timers.tick(2000);
  assert.deepEqual(await first, { kind: "retry" });

  let settled = false;
  const second = fire(p);
  second.then(() => (settled = true));

  t.mock.timers.tick(2000);
  await Promise.resolve();
  assert.equal(settled, false, "second attempt must wait 5s, not 2s");

  t.mock.timers.tick(3000);
  assert.deepEqual(await second, { kind: "retry" });
});

test("stops after maxRetries and hands the failure back to the host", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, fire, logs } = makeCtx();
  apply(ctx, { maxRetries: 2 });
  const p = payload();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const pending = fire(p);
    t.mock.timers.tick(20_000);
    assert.deepEqual(await pending, { kind: "retry" }, `attempt ${attempt} should retry`);
  }

  assert.equal(await fire(p), "native", "the cap must fall through to the host handler");
  assert.ok(
    logs.some(([, m]) => m.includes("最大重试次数")),
    "exhaustion must be logged, not swallowed",
  );
});

test("counters are per provider+turn+step, so other steps are untouched", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, fire } = makeCtx();
  apply(ctx, { maxRetries: 1, log: false });

  const step0 = payload({ step: 0 });
  const a = fire(step0);
  t.mock.timers.tick(20_000);
  assert.deepEqual(await a, { kind: "retry" });
  assert.equal(await fire(step0), "native", "same key is now exhausted");

  const step1 = { ...step0, step: 1 };
  const b = fire(step1);
  t.mock.timers.tick(20_000);
  assert.deepEqual(await b, { kind: "retry" }, "a different step has its own counter");
});

test("a disabled plugin never touches the error", async () => {
  const { ctx, fire } = makeCtx();
  apply(ctx, { enabled: false });
  assert.equal(await fire(payload()), "native");
});

test("an already-aborted signal is not retried", async () => {
  const { ctx, fire } = makeCtx();
  apply(ctx, {});
  const controller = new AbortController();
  controller.abort();
  assert.equal(await fire(payload({ signal: controller.signal })), "native");
});

test("aborting during the wait abandons the retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, fire } = makeCtx();
  apply(ctx, { log: false });

  const controller = new AbortController();
  const pending = fire(payload({ signal: controller.signal }));
  controller.abort();
  t.mock.timers.tick(2000);
  assert.equal(
    await pending,
    undefined,
    "an aborted wait returns nothing, so the host keeps the original error",
  );
});
