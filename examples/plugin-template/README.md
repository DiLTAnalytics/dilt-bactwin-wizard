# Plugin template

Copy this folder and edit it. A plugin brings reference data: keys, a catalogue of combinations,
optionally a name template. It is **data only**; no code is ever loaded from a plugin.

Declare its licence in the manifest. The bundled plugins and this template are `AGPL-3.0-only`;
please publish yours the same way and offer it as a pull request into `plugins/`.

## Layout

```
bactwin-plugin.json      manifest (required)
keys.json                key entries
combinations.csv         Keys-Combinations
name-template.json       only to replace the name structure
README.md                what the plugin is
```

Only these names are read; each data file is there when `provides` lists it.

## Manifest

```json
{
  "id": "demo",
  "name": "Demo vocabulary",
  "version": "1.0.0",
  "sourceId": "DEMO",
  "engineRange": "^1.0.0",
  "license": "AGPL-3.0-only",
  "provides": ["keys", "combinations"],
  "description": "Ein kurzer Satz auf Deutsch, in den Einstellungen angezeigt."
}
```

- `sourceId` tags every key entry of the plugin.
- `provides` must match what the plugin ships.
- `requires` (optional) lists the ids of plugins it builds on, e.g. `["amev-2026"]` for keys that
  rely on the AMEV name template. Switching it on switches those on too; without them it is not loaded.
- `engineRange` (`1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`) is checked on load; an incompatible plugin is not loaded.

## Key entries

A JSON array in `keys.json`:

```json
[
  { "block": "gewerk", "key": "HZG", "name": "Heizung", "description": "Heizungsanlagen",
    "default_gewerk": ["HZG"], "deprecated": false, "key_number": "420" }
]
```

| Field | | |
|---|---|---|
| `block` | required | `gewerk`, `anlage`, `baugruppe`, `medium_position`, `aggregat`, `betriebsmittel`, `funktion` or `funktion_erweiterung`; anything else is an error |
| `key` | required | The value written into the name, e.g. `HZG` |
| `name`, `description` | optional | Shown in the dropdowns |
| `default_gewerk` | optional | Trades the key fits; drives the "Gewerk" mode. Without it the key is offered everywhere |
| `deprecated` | optional | `true` instead of deleting: existing projects keep the key, with a warning |
| `key_number` | optional | An official number, e.g. a trade's number in a standard |

### Adding keys to the bundled vocabulary

A manifest and one key file are enough:

```
my-keys/
  bactwin-plugin.json    {"id": "my-keys", "name": "Eigene Keys", "version": "1.0.0", "sourceId": "MINE",
                          "engineRange": "^1.0.0", "license": "AGPL-3.0-only", "provides": ["keys"]}
  keys.json              [{"block": "anlage", "key": "SPA", "name": "Sprinkleranlage", "default_gewerk": ["GWA"]}]
```

A new `block` + `key` adds a key. The same `block` + `key` as an existing one replaces it: plugins
installed by the user load after the bundled ones, folders alphabetically, and Settings lists every
replacement.

## Combination rows

```csv
gewerk,anlage,baugruppe,medium_position,aggregat,betriebsmittel,funktion,funktion_erweiterung,object_type,unit_code,bactwin_name
HZG,VTA,HZK,HZ~,WMZ,TD~,MW~,,0,62,HZG_VTA_HZK_HZ~_WMZ_TD~_MW~
```

Separated by `,` or `;` (as German Excel saves it); quoted cells may hold line breaks. A file
without a name-block column, or with a row of another length, is not loaded.

**An empty cell is a wildcard**, not a value. The catalogue narrows the options and flags
violations; it never blocks a write.

## Installing

**Datei → Plugin installieren…** opens the plugin folder. Copy your folder in, then switch the plugin
on per project in Projekteigenschaften (or for new projects in App-Einstellungen). Problems are
listed in App-Einstellungen; a broken plugin is skipped.

## This template's data

17 keys and 4 combination rows, entirely invented. They equal the conformance corpus's `demo` bundle
(`packages/mapping-engine/test/reference/demo.json`); a test fails if the two differ.
