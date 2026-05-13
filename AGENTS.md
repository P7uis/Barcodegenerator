# AGENTS.md — Conventions for AI assistants working on this repo

> Read this file before changing anything. It applies to every AI tool
> (Cursor, Claude Code, Codex, GitHub Copilot, etc.) and every human
> contributor too.

## 1. Mandatory version bump on every change

Every change shipped to this repo **must** bump the version. No exceptions.

This includes:
- feature additions, refactors, bug fixes,
- deployment-only fixes (e.g. shipping a missing vendor asset),
- docs / README edits, copy / i18n tweaks, CSS-only tweaks,
- dependency bumps.

Update **both** locations in the **same** commit, with the **same**
new version number:

1. `index.html` — the `<span id="app-footer-version">` element inside
   `<footer class="app-footer">` (the floating pill at bottom-right).
2. `package.json` — the `"version"` field.

The footer in the running app reads from `index.html`. If you forget to
bump, real users will see a stale version number — please don't.

### Semver rules (current pattern: `MAJOR.MINOR.PATCH`)

- **patch** (`x.y.Z` → `x.y.Z+1`): fixes, docs, chores, deployment
  fixes, internal refactors with no user-visible behavior change.
- **minor** (`x.Y.0` → `x.(Y+1).0`): new user-visible feature, new UI,
  new option, new language, etc.
- **major** (`X.0.0` → `(X+1).0.0`): breaking changes (file format,
  storage key migrations without compat, removed features, etc.).

### Pre-commit checklist

- [ ] Did I change anything? → Yes → bump required.
- [ ] Did I update **both** `index.html` and `package.json`?
- [ ] Do both files show the **same** new version?
- [ ] Does the bump match semver (patch / minor / major)?

## 2. Other notes

- License: GPL v3 (see `LICENSE`). Don't change this without explicit
  user approval.
- Author / maintainer: P7uis on GitHub.
- Single-page app — `index.html` is the only HTML entry point.
- Static checks live at `tests/static-checks.mjs`; run
  `npm test` after substantive changes.
- Vendor assets in `vendor/` must be tracked by git, otherwise
  GitHub Pages returns 404 for them in production.
