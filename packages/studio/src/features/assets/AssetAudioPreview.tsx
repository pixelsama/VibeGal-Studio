import { useMemo, useRef, useState } from "react";
import { resolveAssetUrl } from "./assetPreview";

export interface AudioPreviewHandle {
  pause: () => void;
}

export function createExclusiveAudioPreviewController() {
  let active: { key: string; handle: AudioPreviewHandle } | null = null;
  return {
    requestPlayback(key: string, handle: AudioPreviewHandle) {
      if (active && active.key !== key) active.handle.pause();
      active = { key, handle };
    },
    clear(key: string) {
      if (active?.key === key) active = null;
    },
  };
}

const previewController = createExclusiveAudioPreviewController();

export function describeAudioAsset(relPath: string, size: number): { format: string; size: string } {
  const ext = relPath.split(".").pop()?.toUpperCase() ?? "AUDIO";
  return {
    format: ext,
    size: formatAssetSize(size),
  };
}

export function AssetAudioPreview({
  projectPath,
  relPath,
  size,
}: {
  projectPath: string;
  relPath: string;
  size: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const meta = useMemo(() => describeAudioAsset(relPath, size), [relPath, size]);
  const src = resolveAssetUrl(projectPath, relPath);

  return (
    <div style={rootStyle}>
      <audio
        ref={audioRef}
        src={src}
        controls
        style={audioStyle}
        onPlay={() => {
          if (audioRef.current) previewController.requestPlayback(relPath, audioRef.current);
        }}
        onPause={() => previewController.clear(relPath)}
        onEnded={() => previewController.clear(relPath)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? null)}
      />
      <div style={metaStyle}>
        <span>{meta.format}</span>
        <span>{meta.size}</span>
        {duration != null && Number.isFinite(duration) ? <span>{formatDuration(duration)}</span> : null}
      </div>
    </div>
  );
}

function formatAssetSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  width: "100%",
};

const audioStyle: React.CSSProperties = {
  width: "90%",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "center",
  fontSize: 11,
  color: "var(--text-muted)",
};
