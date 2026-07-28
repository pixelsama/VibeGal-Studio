#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const DEFAULT_CHROME = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome";
const fingerprint = "a".repeat(64);

export async function runStudioBrowserBenchmark({
  chromePath = process.env.VIBEGAL_CHROME_PATH || DEFAULT_CHROME,
  studioUrl,
  projectPath,
}) {
  if (!studioUrl || !projectPath) throw new Error("studioUrl and projectPath are required");

  const [project, rendererFiles] = await Promise.all([
    loadBenchmarkProject(projectPath),
    loadRendererFiles(projectPath),
  ]);
  const assets = assetEntries(project.content.manifest);
  const { port, process: chrome, userDataDir } = await launchChrome(chromePath, studioUrl);
  let cdp;
  let stopHeapSampling = async () => {};
  try {
    const page = await waitForPage(port, studioUrl, chrome);
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await Promise.all([
      cdp.send("Runtime.enable"),
      cdp.send("Page.enable"),
      cdp.send("Performance.enable"),
    ]);
    await installBenchmarkBridge(cdp, { project, assets, rendererFiles });
    let peakJsHeapBytes = 0;
    const sampleHeap = async () => {
      const metrics = await cdp.send("Performance.getMetrics");
      const used = metric(metrics.metrics, "JSHeapUsedSize");
      peakJsHeapBytes = Math.max(peakJsHeapBytes, used);
      return used;
    };
    let heapSamplingStopped = false;
    const heapSampler = (async () => {
      while (!heapSamplingStopped) {
        await sampleHeap();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })();
    stopHeapSampling = async () => {
      heapSamplingStopped = true;
      await heapSampler;
    };

    await cdp.send("Page.navigate", { url: studioUrl });
    await cdp.waitFor("Page.loadEventFired", () => true, 15_000);
    await waitForExpression(cdp, "document.body.innerText.includes('VibeGal-Studio') && [...document.querySelectorAll('button')].some((button) => button.textContent.includes('VibeGal Scale Benchmark'))", 15_000);
    const workspaceStarted = performance.now();
    await clickButtonContaining(cdp, "VibeGal Scale Benchmark");
    await waitForExpression(cdp, "document.querySelector('header button') && document.body.innerText.includes('规模基准项目')", 15_000);
    const workspaceInteractiveMs = performance.now() - workspaceStarted;
    await sampleHeap();

    const graphStarted = performance.now();
    await clickButton(cdp, "脚本");
    await waitForExpression(cdp, "document.querySelector('.react-flow')", 15_000);
    const graphInteractiveMs = performance.now() - graphStarted;
    await sampleHeap();

    const nodeScroll = await measureNodeListScroll(cdp);
    await sampleHeap();
    const save = await measureSingleNodeSave(cdp, sampleHeap);

    const assetsStarted = performance.now();
    await clickButton(cdp, "资产");
    await waitForExpression(cdp, "document.querySelector('[role=grid][aria-label=\"资产列表\"]')", 15_000);
    const assetsFirstRenderMs = performance.now() - assetsStarted;
    await sampleHeap();
    const assetState = await inspectAssetGrid(cdp);
    const assetSearch = await measureAssetSearch(cdp, sampleHeap);

    const jsHeapUsedBytes = await sampleHeap();
    await stopHeapSampling();
    stopHeapSampling = async () => {};

    return {
      status: "completed",
      browser: {
        name: "Google Chrome",
        version: page.browserVersion,
        viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
      },
      measurements: {
        workspaceInteractiveMs: round(workspaceInteractiveMs),
        assetsFirstRenderMs: round(assetsFirstRenderMs),
        assetSearchInputP95Ms: round(percentile(assetSearch.samples, 0.95)),
        nodeListScrollP95FrameMs: round(percentile(nodeScroll.frames, 0.95)),
        graphInteractiveMs: round(graphInteractiveMs),
        singleNodeEditSaveP95Ms: round(percentile(save.samples, 0.95)),
        peakJsHeapBytes,
        jsHeapUsedBytes,
      },
      assertions: {
        workspaceInteractive: workspaceInteractiveMs <= 3_000,
        assetsFirstRender: assetsFirstRenderMs <= 1_000,
        assetSearchInput: percentile(assetSearch.samples, 0.95) <= 100,
        nodeListScroll: percentile(nodeScroll.frames, 0.95) <= 32,
        graphInteractive: graphInteractiveMs <= 2_000,
        singleNodeEditSave: percentile(save.samples, 0.95) <= 150,
        assetDomBounded: assetState.mountedCards <= 80,
        assetCardsDoNotOverlap: assetState.overlapPairs === 0,
        assetGridAccessible: assetState.rowCount > 0 && assetState.columnCount > 0,
      },
      details: {
        assetSearchSamplesMs: assetSearch.samples.map(round),
        assetSearchWarmupMs: round(assetSearch.warmupMs),
        nodeScrollFramesMs: nodeScroll.frames.map(round),
        nodeScrollMountedOptions: nodeScroll.mountedOptions,
        singleNodeSaveSamplesMs: save.samples.map(round),
        singleNodeSaveWarmupSamplesMs: save.warmupSamplesMs.map(round),
        assetMountedCards: assetState.mountedCards,
        assetGridRows: assetState.rowCount,
        assetGridColumns: assetState.columnCount,
        assetOverlapPairs: assetState.overlapPairs,
        commands: await readInvokeStats(cdp),
      },
    };
  } finally {
    await stopHeapSampling().catch(() => {});
    cdp?.close();
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (chrome.exitCode == null) chrome.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function loadBenchmarkProject(projectPath) {
  const [meta, graph, manifest, contentMeta, variables, locales] = await Promise.all([
    readJson(path.join(projectPath, "gal.project.json")),
    readJson(path.join(projectPath, "content/graph.json")),
    readJson(path.join(projectPath, "content/manifest.json")),
    readJson(path.join(projectPath, "content/meta.json")),
    readJson(path.join(projectPath, "content/variables.json")),
    readJson(path.join(projectPath, "content/locales/zh-CN.json")),
  ]);
  const nodes = await Promise.all(graph.nodes.map(async (node) => ({
    relPath: node.file,
    data: await readJson(path.join(projectPath, "content", node.file)),
  })));
  const nodeRevisions = Object.fromEntries(nodes.map((entry, index) => [
    entry.relPath,
    revision(`content/${entry.relPath}`, JSON.stringify(entry.data), index + 10),
  ]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }
  const projectReport = { projectIssues: [] };
  return {
    path: projectPath,
    meta,
    content: { manifest, meta: contentMeta, variables },
    rendererIds: ["default"],
    graph,
    nodeSummaries: graph.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      relPath: node.file,
      chapterId: node.chapterId,
      exists: true,
      incoming: incoming.get(node.id) ?? 0,
      outgoing: outgoing.get(node.id) ?? 0,
      revision: nodeRevisions[node.file],
    })),
    graphRevision: revision("content/graph.json", JSON.stringify(graph), 1),
    manifestRevision: revision("content/manifest.json", JSON.stringify(manifest), 2),
    variablesRevision: revision("content/variables.json", JSON.stringify(variables), 3),
    metaRevision: revision("content/meta.json", JSON.stringify(contentMeta), 4),
    projectRevision: revision("gal.project.json", JSON.stringify(meta), 5),
    nodeRevisions,
    locales: [{ locale: "zh-CN", relPath: "content/locales/zh-CN.json", value: locales }],
    fixtures: [],
    analysisComplete: false,
    graphReport: { graphIssues: [] },
    assetReport: { assetIssues: [] },
    projectReport,
    nodes,
  };
}

async function loadRendererFiles(projectPath) {
  const content = await readFile(path.join(projectPath, "renderers/default/index.tsx"), "utf8");
  return [{ path: "index.tsx", content }];
}

function assetEntries(manifest) {
  const result = [];
  const add = (relPath, kind) => result.push({
    relPath,
    kind,
    size: relPath.endsWith(".svg") ? 128 : 24,
    ...(relPath.endsWith(".svg") ? { imageWidth: 32, imageHeight: 18 } : {}),
    revision: revision(`content/${relPath}`, relPath, result.length + 2_000),
  });
  Object.values(manifest.backgrounds).forEach((value) => add(value, "background"));
  Object.values(manifest.audio.bgm).forEach((value) => add(value, "bgm"));
  Object.values(manifest.cg).forEach((value) => add(value.path, "cg"));
  Object.values(manifest.videos).forEach((value) => add(value.path, "video"));
  Object.values(manifest.fonts).forEach((value) => add(value.path, "font"));
  for (const character of Object.values(manifest.characters)) {
    Object.values(character.sprites).forEach((value) => add(value, "character"));
  }
  return result;
}

function revision(relPath, content, mtimeMs) {
  return {
    relPath,
    mtimeMs,
    size: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function installBenchmarkBridge(cdp, data) {
  const source = `(() => {
    const data = ${JSON.stringify(data)};
    const nodeMap = new Map(data.project.nodes.map((entry) => [entry.relPath, entry]));
    const stats = Object.create(null);
    window.localStorage.setItem("vibegal.recentProjects.v1", JSON.stringify([{ path: data.project.path, name: data.project.meta.name, lastOpenedAt: "2026-07-27T00:00:00.000Z" }]));
    window.localStorage.setItem("vibegal.sidebarPrefs.v1", JSON.stringify({ scriptOutlineCollapsed: false, assetsSidebarCollapsed: false }));
    window.__VIBEGAL_BENCHMARK__ = { stats, saveNodeCompleted: 0, lastSaveNodeCompletedAt: 0 };
    window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};
    window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } };
    const callbacks = new Map();
    let callbackId = 1;
    window.__TAURI_INTERNALS__.transformCallback = (callback, once = false) => {
      const id = callbackId++;
      callbacks.set(id, (value) => { if (once) callbacks.delete(id); return callback?.(value); });
      return id;
    };
    window.__TAURI_INTERNALS__.unregisterCallback = (id) => callbacks.delete(id);
    window.__TAURI_INTERNALS__.runCallback = (id, value) => callbacks.get(id)?.(value);
    window.__TAURI_INTERNALS__.callbacks = callbacks;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = () => {};
    const copy = (value) => structuredClone(value);
    window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      stats[command] = (stats[command] || 0) + 1;
      switch (command) {
        case "load_app_settings": return { theme: "system", rendererTrust: { [JSON.stringify([data.project.path, "default"])]: "${fingerprint}" } };
        case "save_app_settings": return null;
        case "open_project": return copy({ ...data.project, nodes: undefined });
        case "read_project_nodes": return copy(data.project.nodes);
        case "read_node_detail": {
          const entry = nodeMap.get(args.relPath);
          if (!entry) throw new Error("missing node " + args.relPath);
          return copy({ relPath: entry.relPath, data: entry.data, revision: data.project.nodeRevisions[entry.relPath] });
        }
        case "save_node": {
          const entry = nodeMap.get(args.nodeFile);
          if (!entry) throw new Error("missing node " + args.nodeFile);
          entry.data = copy(args.instructions);
          const next = { ...data.project.nodeRevisions[args.nodeFile], mtimeMs: performance.now(), size: JSON.stringify(args.instructions).length, sha256: "b".repeat(64) };
          data.project.nodeRevisions[args.nodeFile] = next;
          window.__VIBEGAL_BENCHMARK__.saveNodeCompleted += 1;
          window.__VIBEGAL_BENCHMARK__.lastSaveNodeCompletedAt = performance.now();
          return copy({ instructions: args.instructions, serializedText: JSON.stringify(args.instructions, null, 2), revision: next, assigned: [] });
        }
        case "list_assets": return copy(data.assets);
        case "read_asset_thumbnail_data_url": return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSczMicgaGVpZ2h0PScxOCc+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzE4JyBmaWxsPScjMzM0MTU1Jy8+PC9zdmc+";
        case "renderer_source_fingerprint": return "${fingerprint}";
        case "read_renderer_source": return copy({ files: data.rendererFiles, fingerprint: "${fingerprint}" });
        case "analyze_project": return copy({ graphReport: data.project.graphReport, assetReport: data.project.assetReport, projectReport: data.project.projectReport });
        case "watch_project":
        case "unwatch_project":
        case "plugin:event|unlisten": return null;
        case "plugin:event|listen": return args.handler;
        case "plugin:event|emit": return null;
        case "plugin:window|start_dragging": return null;
        default: throw new Error("Unhandled benchmark command: " + command);
      }
    };
  })();`;
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
}

async function measureNodeListScroll(cdp) {
  const result = await evaluate(cdp, `new Promise((resolve) => {
    const list = document.querySelector('[role=listbox][aria-label="章节节点"]');
    const frames = [];
    let remaining = 32;
    let previous = null;
    function step(now) {
      if (previous != null) frames.push(now - previous);
      previous = now;
      list.scrollTop = remaining % 2 ? list.scrollHeight : 0;
      list.dispatchEvent(new Event('scroll', { bubbles: true }));
      remaining -= 1;
      if (remaining <= 0) requestAnimationFrame(() => resolve({ frames: frames.slice(8), mountedOptions: list.querySelectorAll('[role=option]').length }));
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  })`);
  return result;
}

async function measureSingleNodeSave(cdp, sampleHeap) {
  await evaluate(cdp, `(() => {
    const option = document.querySelector('[role=listbox][aria-label="章节节点"] [role=option]');
    if (!option) throw new Error('node outline option not found');
    option.click();
  })()`);
  await waitForExpression(
    cdp,
    "[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '进入编辑' && !button.disabled)",
    5_000,
  );
  await clickButton(cdp, "进入编辑");
  await waitForExpression(cdp, "document.querySelector('textarea[aria-label=\"剧本文本\"]')", 15_000);
  const samples = [];
  for (let index = 0; index < 6; index += 1) {
    const completedBefore = await evaluate(cdp, "window.__VIBEGAL_BENCHMARK__.saveNodeCompleted");
    await evaluate(cdp, `(() => {
      const textarea = document.querySelector('textarea[aria-label="剧本文本"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, textarea.value.replace(/测量(?: [0-9]+)?。?$/, '') + '\\n规模保存测量 ${index}。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitForExpression(cdp, "[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '保存' && !button.disabled)", 5_000);
    const started = await evaluate(cdp, "performance.now()");
    await clickButton(cdp, "保存");
    await waitForExpression(
      cdp,
      `window.__VIBEGAL_BENCHMARK__.saveNodeCompleted > ${completedBefore}`,
      5_000,
    );
    const completedAt = await evaluate(cdp, "window.__VIBEGAL_BENCHMARK__.lastSaveNodeCompletedAt");
    samples.push(completedAt - started);
    await waitForExpression(cdp, "document.querySelector('textarea[aria-label=\"剧本文本\"]') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '保存' && !button.disabled)", 5_000);
  }
  await sampleHeap();
  return { samples: samples.slice(2), warmupSamplesMs: samples.slice(0, 2) };
}

async function inspectAssetGrid(cdp) {
  return evaluate(cdp, `(() => {
    const grid = document.querySelector('[role=grid][aria-label="资产列表"]');
    const cells = [...grid.querySelectorAll('[role=gridcell]')];
    const rects = cells.map((cell) => cell.getBoundingClientRect());
    let overlapPairs = 0;
    for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
      if (rects[i].left < rects[j].right && rects[i].right > rects[j].left && rects[i].top < rects[j].bottom && rects[i].bottom > rects[j].top) overlapPairs += 1;
    }
    return { mountedCards: cells.length, rowCount: Number(grid.getAttribute('aria-rowcount')), columnCount: Number(grid.getAttribute('aria-colcount')), overlapPairs };
  })()`);
}

async function measureAssetSearch(cdp, sampleHeap) {
  const samples = [];
  const values = [
    { value: "background_09", count: 10 },
    { value: "background_0", count: 100 },
    { value: "background_08", count: 10 },
    { value: "background_0", count: 100 },
    { value: "background_07", count: 10 },
    { value: "background_0", count: 100 },
    { value: "background_06", count: 10 },
    { value: "background_0", count: 100 },
    { value: "background_05", count: 10 },
    { value: "background_0", count: 100 },
    { value: "background_04", count: 10 },
    { value: "background_0", count: 100 },
    { value: "background_03", count: 10 },
  ];
  for (const { value, count } of values) {
    const sample = await evaluate(cdp, `new Promise((resolve, reject) => {
      const input = document.querySelector('input[aria-label="搜索资产"]');
      const grid = document.querySelector('[role=grid][aria-label="资产列表"]');
      if (!input || !grid) { reject(new Error('asset search controls not found')); return; }
      const columns = Number(grid.getAttribute('aria-colcount'));
      const expectedRows = Math.ceil(${count} / columns);
      const started = performance.now();
      const timer = setTimeout(() => reject(new Error(
        'asset search did not render: value=${value}, expectedRows=' + expectedRows
          + ', actualRows=' + grid.getAttribute('aria-rowcount')
          + ', inputValue=' + input.value
      )), 2_000);
      const check = () => {
        if (Number(grid.getAttribute('aria-rowcount')) === expectedRows) {
          clearTimeout(timer);
          requestAnimationFrame(() => resolve(performance.now() - started));
          return;
        }
        requestAnimationFrame(check);
      };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      requestAnimationFrame(check);
    })`);
    samples.push(sample);
    await sampleHeap();
  }
  return { samples: samples.slice(1), warmupMs: samples[0] };
}

async function readInvokeStats(cdp) {
  return evaluate(cdp, "window.__VIBEGAL_BENCHMARK__.stats");
}

async function clickButtonContaining(cdp, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.includes(${JSON.stringify(label)}) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`button not found containing: ${label}`);
}

async function clickButton(cdp, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)} && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`button not found: ${label}`);
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Browser evaluation failed");
  return response.result.value;
}

async function launchChrome(chromePath, studioUrl) {
  const userDataDir = path.join(process.env.TMPDIR || "/tmp", `vibegal-chrome-${process.pid}`);
  const child = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1440,1000",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-features=Translate,BackForwardCache",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) return { port: Number(match[1]), process: child, userDataDir };
    if (child.exitCode != null) throw new Error(`Chrome exited before startup (${child.exitCode}): ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  child.kill("SIGKILL");
  throw new Error(`Timed out starting Chrome for ${studioUrl}: ${stderr}`);
}

async function waitForPage(port, studioUrl, chrome) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (chrome.exitCode != null) throw new Error(`Chrome exited with ${chrome.exitCode}`);
    try {
      const [version, pages] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()),
        fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()),
      ]);
      const page = pages.find((target) => target.type === "page");
      if (page) return { ...page, browserVersion: version.Browser };
    } catch {
      // Chrome can accept TCP slightly after logging the DevTools URL.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No CDP page target for ${studioUrl}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (!request) return;
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    async waitFor(method, predicate, timeoutMs) {
      return new Promise((resolve, reject) => {
        const values = listeners.get(method) ?? [];
        const listener = (params) => {
          if (!predicate(params)) return;
          clearTimeout(timer);
          listeners.set(method, values.filter((value) => value !== listener));
          resolve(params);
        };
        const timer = setTimeout(() => {
          listeners.set(method, values.filter((value) => value !== listener));
          reject(new Error(`Timed out waiting for CDP event ${method}`));
        }, timeoutMs);
        listeners.set(method, [...values, listener]);
      });
    },
    close() {
      socket.close();
    },
  };
}

function metric(metrics, name) {
  return metrics.find((entry) => entry.name === name)?.value ?? 0;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return Number(value.toFixed(3));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
