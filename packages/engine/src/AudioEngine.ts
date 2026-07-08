/**
 * AudioEngine —— 真正播放声音的那一层。
 *
 * 职责边界：
 *   - 它消费 NovelState.audio 的变化（bgm/sfx/voice），调用 Web Audio / HTMLAudioElement 播放。
 *   - 音频没有「渲染自由度」（BGM 淡入就是淡入，不像立绘可以滑入/弹入），
 *     所以它属于引擎，不属于可替换的 components/。
 *
 * 设计：被动 diff。上层每次 state 变化调用 sync(state)，
 * AudioEngine 自己判断「bgm 变了吗」「有没有新 sfx seq」再决定是否播。
 */
import type { NovelState } from "./state";
import type { Manifest } from "./types";
import { resolveAsset } from "./assetPath";

export class AudioEngine {
  private manifest: Manifest;
  private contentBase: string;
  private bgmEl: HTMLAudioElement | null = null;
  private currentBgmId: string | null = null;
  private bgmFadeTimer: ReturnType<typeof setInterval> | null = null;
  private sfxEls = new Set<HTMLAudioElement>();
  private voiceEl: HTMLAudioElement | null = null;
  private lastVoiceId: string | null = null;
  private playedSfxSeqs = new Set<number>();
  private playedVoiceSeqs = new Set<number>();
  private muted = false;
  private volumes = { master: 1, bgm: 0.8, sfx: 1, voice: 1 };

  constructor(manifest: Manifest, contentBase: string) {
    this.manifest = manifest;
    this.contentBase = contentBase;
  }

  setManifest(manifest: Manifest) {
    this.manifest = manifest;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.bgmEl) this.bgmEl.muted = muted;
    if (this.voiceEl) this.voiceEl.muted = muted;
    for (const el of this.sfxEls) el.muted = muted;
  }

  setVolumes(volumes: Partial<typeof this.volumes>) {
    this.volumes = { ...this.volumes, ...volumes };
    if (this.bgmEl) this.bgmEl.volume = this.channelVolume("bgm");
    if (this.voiceEl) this.voiceEl.volume = this.channelVolume("voice");
    for (const el of this.sfxEls) el.volume = this.channelVolume("sfx");
  }

  /** 上层在每次 NovelState 变化时调用。AudioEngine 内部做 diff，按需播放。 */
  sync(state: NovelState) {
    // ── BGM：只在新 id 出现时切换（淡出旧的、淡入新的） ──
    const bgm = state.audio.bgm;
    if (bgm && bgm.id !== this.currentBgmId) {
      this.switchBgm(bgm.id, bgm.fade, bgm.loop);
    } else if (!bgm && this.currentBgmId) {
      // 显式停止（bgm 指令后续理论上不发 null，但留作扩展）
      this.stopBgm(1000);
    }

    // ── SFX：按 seq 去重，只播没播过的 ──
    for (const sfx of state.audio.sfx) {
      if (this.playedSfxSeqs.has(sfx.seq)) continue;
      this.playedSfxSeqs.add(sfx.seq);
      this.playOneShot(sfx.id, "sfx");
    }

    // ── Voice：同样按 seq 去重 ──
    const voice = state.audio.voice;
    if (voice && !this.playedVoiceSeqs.has(voice.seq)) {
      this.playedVoiceSeqs.add(voice.seq);
      this.lastVoiceId = voice.id;
      this.playOneShot(voice.id, "voice");
    }
  }

  private resolveAudioId(id: string): string | null {
    // audio 拆成 bgm/sfx/voice 三张子表；同一个 id 不应在多张表间重名，
    // 所以按 bgm → sfx → voice 顺序查找即可解析到路径。
    const { bgm, sfx, voice } = this.manifest.audio;
    const rel = bgm[id] ?? sfx[id] ?? voice[id];
    return rel ? resolveAsset(this.contentBase, rel) : null;
  }

  private switchBgm(id: string, fadeMs: number, loop: boolean) {
    const url = this.resolveAudioId(id);
    if (!url) {
      console.warn(`[audio] 未找到 bgm id: ${id}`);
      return;
    }

    // 淡出旧的
    if (this.bgmEl && this.currentBgmId) {
      this.fadeOutAndStop(this.bgmEl, fadeMs);
      this.bgmEl = null;
    }

    const el = new Audio(url);
    el.loop = loop;
    el.muted = this.muted;
    el.volume = 0;
    this.bgmEl = el;
    this.currentBgmId = id;

    el.play().catch((e) => console.warn(`[audio] bgm 播放被阻止（可能需用户交互）:`, e));
    this.fadeIn(el, fadeMs);
  }

  stopBgm(fadeMs = 1000) {
    if (this.bgmEl) {
      this.fadeOutAndStop(this.bgmEl, fadeMs);
      this.bgmEl = null;
    }
    this.currentBgmId = null;
  }

  pauseBgm() {
    this.bgmEl?.pause();
  }

  resumeBgm() {
    this.bgmEl?.play().catch((e) => console.warn(`[audio] bgm 恢复播放失败:`, e));
  }

  replayVoice(id?: string) {
    const voiceId = id ?? this.lastVoiceId;
    if (voiceId) this.playOneShot(voiceId, "voice");
  }

  stopVoice() {
    if (!this.voiceEl) return;
    this.voiceEl.pause();
    this.voiceEl.remove();
    this.voiceEl = null;
  }

  stopAllSfx() {
    for (const el of this.sfxEls) {
      el.pause();
      el.remove();
    }
    this.sfxEls.clear();
  }

  private playOneShot(id: string, channel: "sfx" | "voice") {
    const url = this.resolveAudioId(id);
    if (!url) {
      console.warn(`[audio] 未找到 sfx/voice id: ${id}`);
      return;
    }
    if (channel === "voice") this.stopVoice();
    const el = new Audio(url);
    el.muted = this.muted;
    el.volume = this.channelVolume(channel);
    if (channel === "voice") this.voiceEl = el;
    else this.sfxEls.add(el);
    el.play().catch((e) => console.warn(`[audio] one-shot 播放失败 (${id}):`, e));
    el.addEventListener("ended", () => {
      el.remove();
      if (channel === "voice" && this.voiceEl === el) this.voiceEl = null;
      if (channel === "sfx") this.sfxEls.delete(el);
    });
  }

  private fadeIn(el: HTMLAudioElement, ms: number) {
    this.clearFadeTimer();
    const steps = 20;
    const target = this.channelVolume("bgm");
    const stepMs = Math.max(20, ms / steps);
    let i = 0;
    this.bgmFadeTimer = setInterval(() => {
      i++;
      el.volume = Math.min(target, (i / steps) * target);
      if (i >= steps) this.clearFadeTimer();
    }, stepMs);
  }

  private fadeOutAndStop(el: HTMLAudioElement, ms: number) {
    const start = el.volume;
    const steps = 20;
    const stepMs = Math.max(20, ms / steps);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      el.volume = Math.max(0, start * (1 - i / steps));
      if (i >= steps) {
        clearInterval(timer);
        el.pause();
        el.remove();
      }
    }, stepMs);
  }

  private clearFadeTimer() {
    if (this.bgmFadeTimer) {
      clearInterval(this.bgmFadeTimer);
      this.bgmFadeTimer = null;
    }
  }

  private channelVolume(channel: "bgm" | "sfx" | "voice"): number {
    return Math.max(0, Math.min(1, this.volumes.master * this.volumes[channel]));
  }

  dispose() {
    this.clearFadeTimer();
    if (this.bgmEl) {
      this.bgmEl.pause();
      this.bgmEl.remove();
      this.bgmEl = null;
    }
    this.stopVoice();
    this.stopAllSfx();
    this.playedSfxSeqs.clear();
    this.playedVoiceSeqs.clear();
    this.currentBgmId = null;
  }
}
