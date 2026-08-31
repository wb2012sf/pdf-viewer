# Tauri smoke test

**Passed on Windows, 2026-08-31.** All five checks below were run by hand
against a real build: the window opens, a PDF renders, the stamp gallery
populates, OCR completes, Save writes a file, and all of it works offline.

Still unverified on **macOS and Linux**. The checklist stays here for those, and
for re-running after anything touches asset loading, the CSP or the save path.

It cannot be run on the machine this project is developed on: Tauri needs a Rust
toolchain, the WebKitGTK development libraries (a 630-package dependency
closure) and a display, none of which are available there without root.

## Prerequisites

Pick your platform. All of these need Node installed as well.

### Windows (PowerShell)

```powershell
winget install Rustlang.Rustup
winget install Microsoft.EdgeWebView2Runtime        # no-op on Windows 11
winget install Microsoft.VisualStudio.2022.BuildTools --override `
  "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Reopen PowerShell afterwards so `cargo` is on the PATH.

Build on the Windows host, **not inside WSL** — WSL has no display without
WSLg, and pointing Windows `cargo` at a `\\wsl$\` path causes its own problems.

### Linux

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # no root needed
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev build-essential curl file libssl-dev libayatana-appindicator3-dev
```

A display is required; a headless VPS cannot run this.

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Run it

The same three commands on every platform — PowerShell, cmd, bash, zsh:

```
npm install
npm run tauri:dev      # a window should open
npm run tauri:build    # produces an installer under src-tauri/target/release/bundle/
```

On Windows, if `npm` fails with "running scripts is disabled on this system",
that is PowerShell's execution policy rather than anything to do with this
project: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or call
`npm.cmd` instead of `npm`.

The first `tauri:dev` compiles the whole Rust dependency tree — 5–15 minutes is
normal. After that it starts in seconds.

Any installer `tauri:build` produces is unsigned, so Windows SmartScreen and
macOS Gatekeeper will warn on first run. That is expected and is a separate open
decision (see `DECISIONS.md`).

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
