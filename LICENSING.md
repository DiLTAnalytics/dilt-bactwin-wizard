# Licensing

[`REUSE.toml`](REUSE.toml) is the machine-readable source of truth.

| Path | Licence |
|---|---|
| `apps/**`, `packages/**`, `examples/**`, `scripts/**`, `plugins/**`, `data/**` | `AGPL-3.0-only` |
| `docs/**`, `*.md` | `CC-BY-4.0` |
| Repository configuration | `CC0-1.0` |
| `apps/wizard/assets/**` (DiLT logo and icon) | `LicenseRef-DiLT-trademark` |

Distributing a modified version, or offering it as a network service, means publishing the changes.
The source of every build is <https://github.com/DiLTAnalytics/dilt-bactwin-wizard>; the About
dialog links to it.

## Plugins

Plugins are data only and never contain code. Each declares its licence in `bactwin-plugin.json`;
the About dialog lists them. The bundled plugins are `AGPL-3.0-only`. We ask authors of other
plugins to publish them under `AGPL-3.0-only` too and offer them as a pull request into `plugins/`.

## Trademarks

The DiLT Analytics name, logo and icon are trademarks, not open source. Fork freely, but replace
them before distributing a build. Saying truthfully that your work is based on this project is fine.

"BACtwin" and "AMEV" are names of a third-party system and a standards body, used descriptively.
AMEV is not affiliated with this project and does not endorse it.

## Contributing

Contributions are accepted under the licence of the files you change.
