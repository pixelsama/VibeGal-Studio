#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const NODE_COUNT = 1_000;
const ASSET_COUNT = 500;
const CHAPTER_COUNT = 20;
const ASSETS_PER_KIND = 100;
const SEED = "vibegal-scale-v1";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function padded(index, width = 4) {
  return String(index).padStart(width, "0");
}

function projectGraph() {
  const chapters = Array.from({ length: CHAPTER_COUNT }, (_, index) => {
    const nodeIndex = index * (NODE_COUNT / CHAPTER_COUNT);
    return {
      id: `chapter_${padded(index, 2)}`,
      title: `规模章节 ${index + 1}`,
      ...(index === 0 ? {} : {
        checkpoint: {
          nodeId: `node_${padded(nodeIndex)}`,
          instructionId: `node_${padded(nodeIndex)}_001`,
          vars: { scaleFlag: false },
          background: null,
          sprites: [],
          bgm: null,
        },
      }),
    };
  });
  const nodes = Array.from({ length: NODE_COUNT }, (_, index) => ({
    id: `node_${padded(index)}`,
    title: `节点 ${padded(index)}`,
    file: `nodes/node_${padded(index)}.json`,
    chapterId: chapters[Math.floor(index / (NODE_COUNT / CHAPTER_COUNT))].id,
    position: { x: (index % 20) * 280, y: Math.floor(index / 20) * 160 },
  }));
  const edges = [];
  for (let index = 0; index < NODE_COUNT - 1;) {
    const from = nodes[index].id;
    const remaining = NODE_COUNT - index - 1;
    if (index % 15 === 0 && remaining >= 3) {
      edges.push(
        { id: `${from}__choice_a`, from, to: nodes[index + 1].id, mode: "choice", label: "继续调查", condition: null },
        { id: `${from}__choice_b`, from, to: nodes[index + 2].id, mode: "choice", label: "暂时回避", condition: null },
      );
      index += 2;
    } else if (index % 10 === 0 && remaining >= 3) {
      edges.push(
        { id: `${from}__auto_condition`, from, to: nodes[index + 1].id, mode: "auto", label: null, condition: "scaleFlag == true" },
        { id: `${from}__auto_default`, from, to: nodes[index + 2].id, mode: "auto", label: null, condition: null },
      );
      index += 2;
    } else {
      edges.push({ id: `${from}__linear`, from, to: nodes[index + 1].id, mode: "linear", label: null, condition: null });
      index += 1;
    }
  }
  return { version: 1, entryNodeId: nodes[0].id, chapters, nodes, edges };
}

function assetManifest() {
  const backgrounds = {};
  const audio = { bgm: {}, sfx: {}, voice: {} };
  const cg = {};
  const videos = {};
  const fonts = {};
  const characters = {};
  for (let index = 0; index < ASSETS_PER_KIND; index += 1) {
    const id = padded(index, 3);
    backgrounds[`background_${id}`] = `assets/backgrounds/background_${id}.svg`;
    audio.bgm[`bgm_${id}`] = `assets/audio/bgm_${id}.ogg`;
    cg[`cg_${id}`] = { path: `assets/cg/cg_${id}.svg`, name: `规模 CG ${id}` };
    videos[`video_${id}`] = { path: `assets/videos/video_${id}.mp4`, name: `规模视频 ${id}` };
    fonts[`font_${id}`] = { path: `assets/fonts/font_${id}.woff2`, family: `Scale Font ${id}` };
    if (index < 20) {
      characters[`character_${id}`] = {
        name: `规模角色 ${id}`,
        color: "#ffffff",
        sprites: { default: `assets/characters/character_${id}.svg` },
      };
    }
  }
  return {
    characters,
    backgrounds,
    audio,
    cg,
    videos,
    fonts,
    uiSkins: {},
    animationAtlases: {},
    unlocks: { cg: {}, music: {}, replay: {}, endings: {} },
  };
}

function storyNode(index) {
  const id = `node_${padded(index)}`;
  const instructions = [
    {
      t: "narrate",
      id: `${id}_001`,
      textKey: `${id}.001`,
      text: `规模基准节点 ${padded(index)}，用于确定性加载与编辑测量。`,
    },
  ];
  if (index % 50 === 0) {
    instructions.push({
      t: "say",
      id: `${id}_002`,
      who: `character_${padded(index / 50, 3)}`,
      expr: "default",
      textKey: `${id}.002`,
      text: `角色表达覆盖 ${padded(index / 50, 3)}。`,
    });
  }
  return instructions;
}

function localeTable() {
  const table = {};
  for (let index = 0; index < NODE_COUNT; index += 1) {
    const id = `node_${padded(index)}`;
    table[`${id}.001`] = `规模基准节点 ${padded(index)}，用于确定性加载与编辑测量。`;
    if (index % 50 === 0) {
      table[`${id}.002`] = `角色表达覆盖 ${padded(index / 50, 3)}。`;
    }
  }
  return table;
}

async function writePlaceholder(root, relative, content) {
  const target = path.join(root, "content", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function generate(outDir) {
  const root = path.resolve(outDir);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "content/nodes"), { recursive: true });
  await mkdir(path.join(root, "content/locales"), { recursive: true });

  const graph = projectGraph();
  const manifest = assetManifest();
  await writeFile(path.join(root, "gal.project.json"), stableJson({
    name: "VibeGal Scale Benchmark",
    activeRendererId: "default",
    createdAt: "1785110400",
  }));
  await writeFile(path.join(root, "content/meta.json"), stableJson({
    title: "规模基准项目",
    typingSpeedCps: 30,
    autoAdvanceMs: 1200,
    chapterGapMs: 1500,
    stage: { width: 1280, height: 720 },
    locale: { default: "zh-CN", available: ["zh-CN"] },
  }));
  await writeFile(path.join(root, "content/variables.json"), stableJson({
    version: 1,
    variables: {
      scaleFlag: { kind: "flag", label: "规模分流", type: "boolean", default: false, nullable: false, scope: "run" },
    },
  }));
  await writeFile(path.join(root, "content/graph.json"), stableJson(graph));
  await writeFile(path.join(root, "content/manifest.json"), stableJson(manifest));
  await writeFile(path.join(root, "content/locales/zh-CN.json"), stableJson(localeTable()));

  for (let index = 0; index < NODE_COUNT; index += 1) {
    await writeFile(path.join(root, `content/nodes/node_${padded(index)}.json`), stableJson(storyNode(index)));
  }
  for (let index = 0; index < ASSETS_PER_KIND; index += 1) {
    const id = padded(index, 3);
    await writePlaceholder(root, `assets/backgrounds/background_${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#${id}${id}"/></svg>\n`);
    await writePlaceholder(root, `assets/audio/bgm_${id}.ogg`, "VIBEGAL_SCALE_AUDIO\n");
    await writePlaceholder(root, `assets/cg/cg_${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><text y="12">${id}</text></svg>\n`);
    if (index < 20) {
      await writePlaceholder(root, `assets/characters/character_${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="32"><text y="12">${id}</text></svg>\n`);
    }
    await writePlaceholder(root, `assets/videos/video_${id}.mp4`, "VIBEGAL_SCALE_VIDEO\n");
    await writePlaceholder(root, `assets/fonts/font_${id}.woff2`, "VIBEGAL_SCALE_FONT\n");
  }
  await writeFile(path.join(root, "benchmark.dataset.json"), stableJson({
    schemaVersion: 1,
    seed: SEED,
    nodeCount: NODE_COUNT,
    assetCount: ASSET_COUNT,
    chapterCount: CHAPTER_COUNT,
    assetKinds: { background: 100, audio: 100, cg: 100, video: 100, font: 100 },
    storyStateCount: 1,
    localeCount: 1,
    characterExpressionCount: 20,
    supportingAssetFileCount: 20,
  }));
  process.stdout.write(`${JSON.stringify({ root, seed: SEED, nodes: NODE_COUNT, assets: ASSET_COUNT })}\n`);
}

const outArg = process.argv[2];
if (!outArg) throw new Error("Usage: generate-scale-project.mjs <out-dir>");
await generate(outArg);
