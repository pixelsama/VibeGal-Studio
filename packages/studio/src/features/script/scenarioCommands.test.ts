import { describe, expect, it } from "vitest";
import type { ProjectData } from "../../lib/types";
import {
  defaultScenarioInstruction,
  insertScenarioParameterAtCursor,
  scenarioCommandOptionsForQuery,
  scenarioParameterOptions,
  scenarioParameterTriggerAtCursor,
} from "./scenarioCommands";
import { resolveCatalogMessage } from "../../lib/i18n";

const project: ProjectData = {
  path: "/tmp/project",
  meta: { name: "Project", activeRendererId: "default", createdAt: "2026-01-01T00:00:00.000Z" },
  content: {
    meta: {},
    variables: {
      version: 1,
      variables: {
        affection: { type: "number", default: 0, nullable: false, scope: "run", label: "好感度" },
        playerName: { kind: "text", type: "string", default: "旅行者", nullable: false, scope: "run", label: "玩家名字" },
        route: { kind: "state", type: "string", default: "common", nullable: false, scope: "run", label: "当前路线", options: [{ id: "common", label: "共通线" }] },
      },
    },
    manifest: {
      characters: {
        akari: { name: "明里", color: "#fff", sprites: { default: "akari.png", smile: "akari-smile.png" } },
      },
      backgrounds: { classroom: "classroom.png" },
      audio: { bgm: { daily: "daily.ogg" }, sfx: { bell: "bell.ogg" }, voice: { hello: "hello.ogg" } },
      cg: { reunion: { path: "reunion.png", name: "重逢" } },
      videos: { opening: { path: "opening.mp4", name: "片头" } },
      fonts: {},
      uiSkins: {},
      animationAtlases: {},
      unlocks: {
        cg: { cg_reunion: { assetId: "reunion", title: "重逢 CG" } },
        music: { daily_track: { audioId: "daily", title: "日常曲" } },
        replay: { first_meeting: { nodeId: "start", title: "初遇" } },
        endings: { true_end: { title: "真正的结局", nodeId: "ending" } },
      },
    },
  },
  rendererIds: ["default"],
};

describe("Scenario parameter completion", () => {
  it("detects resource, speaker, expression, story-state, and unlock contexts", () => {
    expect(scenarioParameterTriggerAtCursor("@bg cla", 7)).toMatchObject({ kind: "background", query: "cla" });
    expect(scenarioParameterTriggerAtCursor("aka: 你好", 3)).toMatchObject({ kind: "character", query: "aka" });
    expect(scenarioParameterTriggerAtCursor("akari(sm): 你好", 8)).toMatchObject({
      kind: "expression",
      ownerId: "akari",
      query: "sm",
    });
    expect(scenarioParameterTriggerAtCursor("@char akari sm", 14)).toMatchObject({
      kind: "expression",
      ownerId: "akari",
      query: "sm",
    });
    expect(scenarioParameterTriggerAtCursor("@set aff", 8)).toMatchObject({ kind: "story-state", query: "aff" });
    expect(scenarioParameterTriggerAtCursor("@inputName pla", 14)).toMatchObject({ kind: "name-state", query: "pla" });
    expect(scenarioParameterTriggerAtCursor("@unlock endings tru", 19)).toMatchObject({
      kind: "ending-unlock",
      query: "tru",
    });
    expect(scenarioParameterTriggerAtCursor("@completeEnding tru", 19)).toMatchObject({
      kind: "ending-unlock",
      query: "tru",
    });
  });

  it("provides creator-facing labels but retains stable IDs", () => {
    expect(scenarioParameterOptions(
      { kind: "character", query: "明", replaceStart: 0, replaceEnd: 0, line: 1 },
      project,
    )).toEqual([{ id: "akari", label: "明里", detail: "akari" }]);
    expect(scenarioParameterOptions(
      { kind: "story-state", query: "好感", replaceStart: 0, replaceEnd: 0, line: 1 },
      project,
    )).toEqual([{ id: "affection", label: "好感度", detail: "affection" }]);
    expect(scenarioParameterOptions(
      { kind: "name-state", query: "", replaceStart: 0, replaceEnd: 0, line: 1 },
      project,
    )).toEqual([{ id: "playerName", label: "玩家名字", detail: "playerName" }]);
    expect(scenarioParameterOptions(
      { kind: "cg", query: "重逢", replaceStart: 0, replaceEnd: 0, line: 1 },
      project,
    )[0]).toEqual({ id: "reunion", label: "重逢", detail: "reunion" });
    expect(scenarioParameterOptions(
      { kind: "expression", ownerId: "akari", query: "sm", replaceStart: 0, replaceEnd: 0, line: 1 },
      project,
    )[0]?.id).toBe("smile");
  });

  it("offers a player naming command with a text-state draft", () => {
    expect(scenarioCommandOptionsForQuery("命名")).toEqual([
      expect.objectContaining({ kind: "inputName", label: "玩家命名" }),
    ]);
    expect(defaultScenarioInstruction("inputName", project)).toMatchObject({
      t: "inputName",
      key: "playerName",
      prompt: "怎么称呼你？",
      maxLength: 20,
    });
  });

  it("localizes command labels and details while keeping stable command kinds", () => {
    const t = (key: Parameters<typeof resolveCatalogMessage>[1], params?: Parameters<typeof resolveCatalogMessage>[2]) => (
      resolveCatalogMessage("en", key, params, { strictMissingEnglish: true })
    );
    expect(scenarioCommandOptionsForQuery("name", t)).toEqual([
      expect.objectContaining({ kind: "inputName", label: "Player name", detail: "Ask the player to enter a name" }),
    ]);
  });

  it("replaces only the active token", () => {
    const text = "@bg cla fade\nakari: 你好";
    const trigger = scenarioParameterTriggerAtCursor(text, 7);

    expect(trigger).not.toBeNull();
    expect(insertScenarioParameterAtCursor(text, trigger!, "classroom")).toEqual({
      text: "@bg classroom fade\nakari: 你好",
      cursorOffset: "@bg classroom".length,
    });
  });

  it("does not offer completion outside known parameter positions", () => {
    expect(scenarioParameterTriggerAtCursor("普通旁白", 2)).toBeNull();
    expect(scenarioParameterTriggerAtCursor("@wait 800", 8)).toBeNull();
    expect(scenarioParameterTriggerAtCursor("akari: 台词", 9)).toBeNull();
  });
});
