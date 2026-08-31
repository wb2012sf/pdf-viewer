# Tauri smoke test

The desktop shell is scaffolded but **has never been built or run**. It could
not be, on the machine it was written on: Tauri needs a Rust toolchain, the
WebKitGTK development libraries (a 630-package dependency closure) and a
display, none of which were available and none installable without root.

Everything below is therefore unverified. Run it on a machine with a GUI.

## Prerequisites

- **Rust** — <https://rustup.rs> (`rustup` installs into your home directory, no root needed)
- **Linux only** — the system libraries Tauri links against:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev build-essential curl file libssl-dev libayatana-appindicator3-dev
  ```
- **Windows** — WebView2 (already present on Windows 11) and the MSVC build tools
- **macOS** — Xcode command line tools

WSL will not work without WSLg; build on the host rather than inside WSL.

## Run it

```bash
npm install
npm run tauri:dev      # a window should open
npm run tauri:build    # produces an installer under src-tauri/target/release/bundle/
```

## What to actually check

The point of this exercise is not that a window opens — it is that the parts of
the app which depend on how the page is served still work. Tauri serves over a
custom protocol rather than `http://`, and each of these was built against
browser assumptions:

1. **A PDF renders.** Proves the PDFium WASM module compiled under Tauri's CSP
   and that the engine's web worker started. If the page stays on "Loading
   document…", the worker or the WASM fetch is being blocked.
2. **The stamp gallery populates** (Insert → Rubber Stamp). Proves a bundled
   asset resolves through the custom protocol.
3. **OCR completes** on a scanned page. The heaviest case: a second WASM module,
   a worker loaded from a `blob:` URL, and a 4 MB traineddata fetch. Tesseract
   sets `workerBlobURL` by default, which CSP is most likely to refuse.
4. **Save writes a file.** The webview ignores `<a download>`, so this goes
   through the OS dialog and `tauri-plugin-fs` instead — see
   `src/lib/platform/save-file.ts`. This is the one path with no browser
   equivalent, so it is the most likely to be wrong.
5. **Nothing reaches the network.** Disconnect and repeat 1–4.

## If something breaks

Almost every plausible failure is one of two things:

- **CSP** — loosen `app.security.csp` in `tauri.conf.json`. The risky directives
  are `script-src` (needs `'wasm-unsafe-eval'` and `blob:`) and `worker-src`
  (needs `blob:`). Tauri's dev console reports CSP violations.
- **Permissions** — a denied plugin call means `capabilities/default.json` is
  missing an entry. The error names the permission it wanted.

Asset URLs are resolved with `new URL(asset, location.href)` in
`src/lib/viewer/offline-config.ts` and `stamps.ts`, which is protocol-agnostic
and should survive; if assets 404, that is where to look first.
