# Development and verification

Follow the sibling plugin workflow: Node 24+, npm with a lockfile, TypeScript, esbuild, official Obsidian ESLint rules, and Node's test runner.

```sh
npm ci
npm run lint
npm test
env -u OBSIDIAN_PLUGIN_DIR -u OBSIDIAN_VAULT_DIR npm run build
git diff --check
```

The production build includes both normal and browser-only type checks. Keep host modules external. Runtime dependencies require attribution in `THIRD_PARTY_NOTICES.md`, which is embedded in the JavaScript asset.

See [implementation notes](docs/architecture.md) for rendering ownership, safe resolution, file-format preservation, and guarded native table access. The [coverage matrix](docs/coverage.md) lists every feature fixture.

## Layers of verification

- `test/fixtures/markdown.mjs` defines independent expected Markdown for core syntax families, each exercised as addition, deletion, and replacement.
- Parser and transformation tests verify exact output, source identity, malformed input, frontmatter, escaping, grouping, and 10,000 deterministic generated cases.
- Component tests verify control ownership, read-only comparisons, late renderer results, colours, lifecycle, and overlay positioning.
- Deployment tests verify explicit targets, manifest discovery, preserved settings, build/copy failures, static assets, and host-module externals.
- The real-app matrix compares meaningful DOM structure with Obsidian's native renderer, then checks hover actions, exact saved files, undo/redo, and Reading-view command exclusion.
- The interaction suite covers themes, keyboard input, active table cells, stale/agent edits, CRLF serialization, multiple panes, diagnostics, footnote context, popouts, layout, zoom, delayed content, reloads, and stress fixtures.
- Prose geometry checks retain the original inner padding, exclude extra outer vertical margins and frame borders, and compare wrapping and line bounds with clean paragraphs at the same content width, within 0.5 CSS pixels. They run in Live Preview and Reading at 720px/1280px widths, with light/dark palettes for every required theme.
- Native callout comparisons verify nested, folded, multi-paragraph, code, and math content in both rendered views and all four themes. Descendant positions, dimensions, whitespace, and line heights must match the native callout at the same width within 0.5 CSS pixels.
- Review-bar checks cover proposal counts, native typing and external edits, exact bulk actions and undo/redo, stale snapshots, busy controls, active cells, pane ownership, and action-free Reading view. Separate layout checks cover fixed positioning above titles/properties, hidden titles, narrow panes, scrolling, same-file locks and divergent buffers, and popout migration. Theme checks preserve native status-bar height and verify hover does not move note content.

The PDF comparison checks the stable embed destination and options rather than transient PDF.js DOM. Native table-cell tests compare semantic cell content with an independent native edit because Obsidian owns cell-padding formatting. These exceptions do not weaken exact-file comparisons for ordinary review actions.

## Disposable app runner

```sh
OBSIDIAN_QA_THEME_ROOT="/path/to/installed/themes" npm run test:obsidian
```

The runner creates synthetic notes, media, a PDF, a canvas, and Bases fixtures in a temporary vault and separate application profile. It checks the vault path and a random ownership sentinel before interacting. The debugger is loopback-only. It never changes the personal vault or its profile.

Fixture setup waits for native saves to finish, closes the previous Markdown view, writes the authored fixture through the vault API, and opens a fresh view. It waits for the editor and loaded view data to agree before switching modes. Obsidian's `save()` can return early when another save is already running. Multi-pane and unsaved-buffer cases share views explicitly; the external-agent regression separately writes through the filesystem and waits for Obsidian's watcher.

Render readiness checks wait for the native renderer to be idle and the current comparison to remain stable across animation frames. Keep Playwright polling predicates synchronous: a returned Promise is truthy in this version's polling implementation.

Required theme fixtures: Primary, Minimal, and Blue Topaz. The default theme is tested in light and dark palettes too. Missing prerequisites fail the run rather than silently skipping coverage.

Diagnostic filters are available as `QA_FILTER` for matrix case names and `QA_SECTION` for interaction sections (`status`, `bars`, `refresh`, `themes`, `safety`, `geometry`, `popout`, `performance`). The `status` regressions exercise pending counts and guarded bulk actions in each pane. The `bars` regressions cover pinned layout, split panes, file locks, and migration. The `refresh` regressions cover filesystem edits with remembered carets inside/outside a proposal, editor/sidebar focus, two panes, native typing and blur, simplified comparisons, and invisible link changes. An unfiltered run is required for completion. `QA_ATTACH=1` attaches only to the previously verified disposable session described by `.qa/session.json`; it is intended for local diagnosis.

Generated reports, screenshots, profiles, and logs are ignored. Review selected screenshots before copying them into documentation. A successful browser mock or parser run does not establish compatibility with real Obsidian or another platform.

## Automated releases

The CI and release workflow runs lint, unit tests, type checks, and a deployment-disabled production build for pull requests and pushes to `main`. Successful pushes to `main` then run semantic-release. A manual workflow dispatch can retry a release. Pull requests cannot publish.

Use Conventional Commits: `fix` produces a patch, `feat` a minor, and `!` or a `BREAKING CHANGE:` footer a major. Documentation and maintenance commits alone do not create a release. Without an existing release tag, the first qualifying release is `1.0.0`.

Semantic-release generates `CHANGELOG.md`, synchronizes package/lock/manifest versions through `scripts/prepare-release.mjs`, and adds the compatibility entry while preserving history. It commits that metadata with `[skip ci]`, creates a bare version tag matching the manifest, and publishes `main.js`, `manifest.json`, and `styles.css` on GitHub. Publication uses the workflow's built-in `GITHUB_TOKEN`; npm package publication is disabled. Do not manually bump generated versions or edit the generated changelog.

The release job signs asset attestations, downloads the published files, compares them with the prepared build, and verifies their provenance against this repository's release workflow. Release outputs authorize attestation only after semantic-release reports a completed publication.

Preview a release with `npm run release:dry-run`. Dry runs still verify Git/GitHub access, but do not prepare files, tag, commit, or publish. `npm test` includes isolated local-Git lifecycle tests for initial/patch/minor/major versions, no-op and dry runs, build failures, metadata preservation, notes generation, and release-output guards.
