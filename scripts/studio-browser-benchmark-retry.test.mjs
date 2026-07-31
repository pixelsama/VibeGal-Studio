import assert from "node:assert/strict";
import test from "node:test";

import {
  isTransientCdpError,
  retainedPromise,
  runStudioBrowserBenchmarkWithRetry,
} from "./studio-browser-benchmark.mjs";

test("retainedPromise 把页面内 Promise 挂到 window 防 GC（Promise was collected 根因修复）", async () => {
  const source = retainedPromise(`(resolve) => setTimeout(() => resolve(42), 0)`);

  // 结构断言：求值结果被 window 引用、settle 后自清、返回原 promise
  assert.match(source, /window\[key\] = promise/);
  assert.match(source, /promise\.then\(release, release\)/);
  assert.match(source, /return promise/);

  // 语义断言：在 Node 里以 window=globalThis 模拟页面环境执行
  const window = globalThis;
  const value = await eval(source);
  assert.equal(value, 42);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(window.__VIBEGAL_BENCHMARK_PENDING__, null);
});

test("isTransientCdpError 识别导航/上下文竞态类瞬时 CDP 错误", () => {
  assert.equal(isTransientCdpError(new Error("Promise was collected")), true);
  assert.equal(isTransientCdpError(new Error("Execution context was destroyed, most likely because of a navigation")), true);
  assert.equal(isTransientCdpError(new Error("Inspected target navigated or closed")), true);
  assert.equal(isTransientCdpError(new Error("Target closed")), true);
  assert.equal(isTransientCdpError("Promise was collected"), true);
});

test("isTransientCdpError 不放过真实失败（按钮找不到 / 超时 / 断言）", () => {
  assert.equal(isTransientCdpError(new Error("button not found: [\"脚本\"]")), false);
  assert.equal(isTransientCdpError(new Error("Timed out waiting for: document.querySelector('.react-flow')")), false);
  assert.equal(isTransientCdpError(new Error("Chrome exited before startup (1)")), false);
  assert.equal(isTransientCdpError(new Error("Chrome executable not found")), false);
  assert.equal(isTransientCdpError(undefined), false);
  assert.equal(isTransientCdpError(null), false);
});

test("runStudioBrowserBenchmarkWithRetry 瞬时错误重试到成功", async () => {
  let attempts = 0;
  const result = await runStudioBrowserBenchmarkWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("Promise was collected");
    return { ok: true, attempts };
  }, { maxAttempts: 3, sleep: () => Promise.resolve() });

  assert.deepEqual(result, { ok: true, attempts: 3 });
  assert.equal(attempts, 3);
});

test("runStudioBrowserBenchmarkWithRetry 非瞬时错误立即抛出不重试", async () => {
  let attempts = 0;
  await assert.rejects(
    runStudioBrowserBenchmarkWithRetry(async () => {
      attempts += 1;
      throw new Error("button not found: [\"脚本\"]");
    }, { maxAttempts: 3, sleep: () => Promise.resolve() }),
    /button not found/,
  );
  assert.equal(attempts, 1);
});

test("runStudioBrowserBenchmarkWithRetry 重试耗尽后抛最后一次错误", async () => {
  let attempts = 0;
  await assert.rejects(
    runStudioBrowserBenchmarkWithRetry(async () => {
      attempts += 1;
      throw new Error("Promise was collected");
    }, { maxAttempts: 3, sleep: () => Promise.resolve() }),
    /Promise was collected/,
  );
  assert.equal(attempts, 3);
});
