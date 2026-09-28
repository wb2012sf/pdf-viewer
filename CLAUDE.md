# Project memory: PDF workbench (Preview-equivalent tool)

Last reviewed: 2026-09-28. Update this file whenever a decision below changes; do not let it drift from what the code actually does.

## Repository

- Remote: https://github.com/wb2012sf/pdf-viewer (private).
- Default branch: `main`.
- Claude Code may `git push` without asking. **Force-pushing and remote deletion are denied** by `.claude/settings.json` — `--force`, `-f`, `--force-with-lease`, `--mirror` and `--delete`. A push may add to a remote branch; it may never overwrite or remove one.
- That deny matches command spellings, so it stops the ordinary force-push and not an exotic equivalent (`git push origin +main`). It is a guard rail, not a sandbox; the rule below is what actually holds.
- **Work on a branch, not on `main`.** Anything that changes behaviour — a feature, a fix, a refactor — starts with `git checkout -b claude/<short-name>` and is pushed there. `main` is written to only when the user asks for it in as many words. Pushing `main` is *not* blocked by settings, so this is a rule Claude Code keeps rather than a fence that stops it.
- Docs-only, comment-only or config-only changes may go straight to `main`: there is nothing to review in isolation and a branch would cost more than it explains.
- Pushing a branch is not the same as opening a pull request. `gh pr create` is a separate, outward-facing act and needs its own go-ahead.

## Purpose

A cross-platform tool that replicates the PDF functionality of macOS Preview: view, search, annotate (highlight, note, freehand, shapes), fill existing form fields, stamp a signature image, merge/split/reorder/rotate/extract pages, reduce a file's size by downsampling its images, and OCR scanned pages into searchable text. It is not an Acrobat replacement and should not grow toward reflowable text editing, forms design, or certificate-based signing unless a future decision explicitly says otherwise.

**No Docker, anywhere, and no required server.** The app must run for someone who has only downloaded or been handed it, with nothing else installed, not Docker, not a VPS, not a separate backend. This is a hard constraint, not a preference: it changed the OCR approach (see Stack) and rules out Docker Compose as the deployment model entirely, superseding the earlier VPS/WSL-Compose framing.

## Stack (decided — do not re-litigate without being asked)

- Frontend: TypeScript, React, PDFium rendering via EmbedPDF (client-side WASM; runs entirely in the browser/webview, not on a server).
- Page operations (merge/split/rotate/extract): pdf-lib, pure TS. Runs client-side; it has no Node-only dependency forcing a backend.
- OCR: Tesseract.js (WASM), running client-side alongside PDFium — not ocrmypdf, not Docker, no server-side OCR service. Recognized text is merged back into the PDF as an invisible searchable layer using pdf-lib, built as project code rather than reused from ocrmypdf's pipeline, since ocrmypdf itself only works via Docker or a Python/Ghostscript/qpdf install, exactly what's being avoided. Bundle the language trained-data file(s) (English at minimum) with the app so OCR works fully offline, not fetched at runtime. Accepted tradeoff: lower recognition/deskew quality than ocrmypdf's pipeline, in exchange for zero external runtime dependencies.
- Architecture consequence: with OCR now client-side too, nothing in the current feature scope requires a backend at all. The built output can be a static bundle (viewing, annotation, page manipulation, and OCR all run in the browser/webview). Do not add a Node/Express-style backend "just in case" — if a feature genuinely needs one later, that's a decision to make explicitly, not a default.
- Distribution model: **decided — Tauri-packaged native installer.** Friends download and run a real installer (.exe on Windows, .dmg on Mac, .AppImage/.deb on Linux), fully offline, nothing else to install. No hosted-site path needed; do not build server/hosting infrastructure for distribution. Tauri wraps the same TypeScript/React frontend in a native webview, so this is additive to the frontend work, not a rewrite. **Installers are unsigned (decided 2026-09-28):** no money is spent on code-signing, so Windows SmartScreen and macOS Gatekeeper warn on first run and friends click through once. Signing is on the backlog in `DECISIONS.md`, not rejected; do not buy certificates or set up signing unless asked.
- Testing: Vitest for unit/integration tests, Playwright for browser/end-to-end tests (headless, no display server required).

If a task seems to require deviating from this list, say so and explain why, rather than silently picking something else or stopping to ask which one to use.

## Working agreements

The goal is long, uninterrupted work sessions. Default to proceeding on your best judgment and documenting what you assumed, rather than stopping to ask. Reserve actual stops for the cases below.

### Stop and ask when:

- The action deletes or overwrites data that lives outside version control and can't be recovered from git (files elsewhere on the machine, VPS or local, rows in a non-test database, remote objects).
- The action pushes to `main`, force-pushes, deletes a remote branch, or merges anything into `main`. Pushing the current `claude/*` feature branch is routine and needs no permission.
- The action would incur a real monetary cost (provisioning paid infrastructure, upgrading a paid tier, registering a domain).
- The change alters a public-facing contract in a way that breaks previously saved user data — specifically, anything that would make a PDF annotated or saved by an earlier version of this tool fail to open correctly later. Backward compatibility of saved files is treated as a hard constraint, not a style preference.
- Two materially different architectural directions are both defensible and picking wrong would mean discarding substantial completed work. A naming choice or a local refactor is never this; a decision that reshapes several modules is.
- The change touches authentication, encryption/password handling for PDFs, or opens a new network port.

### Do not ask, just proceed, when:

- Naming a file, function, component, or variable.
- Choosing between two functionally equivalent ways of writing the same logic.
- Adding tests, fixing lint or type errors, refactoring within an existing pattern.
- Filling in a placeholder default (copy text, an error message, a sample value) — mark it clearly as a placeholder in a comment if it's UI-facing.
- Anything fully reversible through git history.

### When you do assume something instead of asking

Record it in `DECISIONS.md` at the repo root (create it if it doesn't exist) as a one-line dated entry: what you assumed, and why. Do not interrupt the session to report it. If the assumption turns out wrong, it's a one-line revert, not a lost afternoon.

## Definition of done

A task is done when: tests pass (`npm run test`), lint and type-check pass (`npm run lint`, `npm run typecheck`), the change is committed with a message that explains why, and — for anything touching the UI — a Playwright screenshot was captured and visually reviewed as part of the change (see Testing policy below). Do not report a task as finished if any of these were skipped; say what's still open instead.

## Conventions

- TypeScript strict mode is always on. No `any` without a comment explaining why it's unavoidable.
- Every exported function has an explicit return type.
- Validate function inputs at module boundaries (parsing untrusted input, file uploads, API request bodies) and fail loudly with a clear error rather than continuing on bad data.
- Tests are written alongside the code they cover, not after, in the same commit. This is a TDD codebase: for new behavior, write the failing test first.
- Commit messages explain the reasoning, not just the change ("why" over "what").
- New files go where the existing structure implies they should go; don't introduce a new top-level directory without a reason worth writing down.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Unit/integration tests: `npm run test`
- Browser/E2E tests (headless): `npm run test:e2e`
- Lint: `npm run lint`
- Type-check: `npm run typecheck`
- Build: `npm run build`
- Local production preview (static build, no server framework): `npm run preview`

## Testing policy (see also: does this need a human to click through it)

Development happens headless, on the Linux VPS or locally in WSL, with no display either way. That is not a testing limitation: Playwright's headless Chromium needs no display server, and screenshots it captures can be read and visually reviewed directly. Practical implications:

- Any change to rendering, annotation, or page-manipulation logic gets a Vitest test that asserts on the actual PDF output (page count, extracted text, structural properties), not just "it didn't throw."
- Any change to the interactive UI gets a Playwright test that drives the browser, takes a screenshot, and the screenshot is reviewed before the task is called done.
- Self-verify before reporting completion. Don't ask the user to check whether something looks right if it's something a screenshot and a test assertion can already confirm.
- Escalate to the user for a manual look only for genuinely subjective judgment calls (does an interaction feel right, does a layout look cluttered) — not for functional correctness.

## Out of scope, do not build unless explicitly asked

- Setting, changing, or removing a PDF password (encryption/decryption). **Dropped from scope on 2026-08-31**, having previously been listed as in scope. pdf-lib cannot encrypt or decrypt, and PDFium's password support is read-side only, so there was no implementation path that did not mean adopting another library. Opening an already-encrypted file still fails loudly rather than silently producing a broken copy (see `src/lib/pdf/page-ops.ts`). Note that the "stop and ask" rule above still covers encryption/password handling: reintroducing this is a decision, not a refactor.
- Reflowable in-place text editing of arbitrary PDF content.
- A forms design/authoring tool.
- Certificate-based, legally binding e-signatures.
- Accessibility (PDF/UA) tagging and verification.
- Anything resembling a commercial multi-tenant product (billing, accounts, multi-user permissions).
