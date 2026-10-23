# Contributing

DiLT Analytics maintains this project and reviews all issues and pull requests.

- **Bugs and features:** open an issue first; for anything beyond a small fix, discuss before building.
- **Security issues:** never as an issue, see [`SECURITY.md`](SECURITY.md).
- **Your own keys or catalogue:** that is a plugin, see [Plugins](#plugins).
- **Conduct:** [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html); report problems to `conduct@dilt.at`.

## Setup and checks

Node 24+ and [pnpm](https://pnpm.io/) (no npm).

```bash
pnpm install
pnpm start                               # the app in development
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e                            # needs a build: pnpm start running, or pnpm --filter @bactwin/wizard package
```

## Rules

- **Licence:** code is `AGPL-3.0-only`, docs `CC-BY-4.0` ([`LICENSING.md`](LICENSING.md)). Files carry
  no licence header; [`REUSE.toml`](REUSE.toml) assigns them by path. A file outside the covered
  folders needs an entry there. Run `reuse lint`.
- **Language:** code, comments, commits, issues and pull requests in English. The UI is German only;
  user-facing text goes through `apps/wizard/src/shared/locales/de.json`, never inline.
- **Domain names stay German** (`gewerk`, `anlage`, `baugruppe`, `funktion`, ...): they are keys in the
  catalogue, key libraries, sequence files and every saved project.
- **Comments** say why, not what.
- **Pure packages:** `packages/mapping-engine` and `packages/plugin-host` use no `fs`, `path`,
  `process`, clock, randomness or locale-dependent sorting. Callers pass content in.
- **Validate at boundaries** with `zod`. No `any` without a reason in a comment.
- **Electron security is fixed:** `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP,
  `app://` protocol, no navigation or new windows. The renderer reaches main only through the typed
  preload bridge.

## Engine changes

The conformance corpus ([`packages/mapping-engine/test/fixtures`](packages/mapping-engine/test/fixtures/README.md))
defines what the engine must do. A behaviour change must change the affected fixtures in the same
pull request and say why the new output is correct. Fixtures are edited by hand.

## File formats

Project and sequence files carry `schema_version`. A change to either format raises it and ships an
upgrade inside the app that reads every earlier 1.x file; files are never left for the user to convert.

## Plugins

Key libraries, combination catalogues and name templates are data-only plugins; no code is ever
loaded from one. Start from [`examples/plugin-template`](examples/plugin-template/README.md). Please
publish yours under `AGPL-3.0-only` and offer it as a pull request into `plugins/`.

## Pull requests

- One logical change, with what and why.
- Update `docs/user/` (the in-app help, German) in the same pull request.
- CI must pass: typecheck, lint, tests, `reuse lint`.
