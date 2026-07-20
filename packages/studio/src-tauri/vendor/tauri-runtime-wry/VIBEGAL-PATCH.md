# VibeGal patch

This directory vendors `tauri-runtime-wry` 2.11.4 from crates.io.

VibeGal changes one runtime-initialization check in `src/lib.rs`: macOS skips
`wry::webview_version()` and assumes the system WKWebView runtime is present.
That probe calls `NSBundle bundleWithIdentifier:` and can crash inside
CoreFoundation on macOS 15 when the application has a non-ASCII executable
name (tauri-apps/tauri#13996). The actual WKWebView creation still runs and is
covered by the installed-CLI desktop smoke test.

Windows, Linux, and the other supported targets keep the upstream availability
probe. Remove this patch after upstream no longer performs the NSBundle probe
during macOS runtime initialization.
