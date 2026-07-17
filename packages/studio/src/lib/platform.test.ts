import { describe, expect, it } from "vitest";
import { detectDesktopPlatform } from "./platform";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const MACOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("detectDesktopPlatform", () => {
  it("detects Windows / macOS / Linux from the WebView user agent", () => {
    expect(detectDesktopPlatform(WINDOWS_UA)).toBe("windows");
    expect(detectDesktopPlatform(MACOS_UA)).toBe("macos");
    expect(detectDesktopPlatform(LINUX_UA)).toBe("linux");
  });

  it("falls back to unknown for empty or unrecognized agents", () => {
    expect(detectDesktopPlatform("")).toBe("unknown");
    expect(detectDesktopPlatform("Mozilla/5.0 (FreeBSD)")).toBe("unknown");
  });
});
