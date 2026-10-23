# BACtwin Wizard

Desktop-App, die BACnet-Datenpunktnamen aus EDE-Dateien auf den BACtwin-Namensstandard übersetzt.
Die Übersetzung wird als **Mapping-Sequenz** gespeichert: eine geordnete Liste von Schritten, die
sich auf jeden neuen Export erneut anwenden lässt.

## So funktioniert es

- EDE-Dateien importieren.
- Ein Schritt wählt eine Gruppe von Datenpunkten (**Wenn**) und setzt ihre Namensbausteine (**Dann**).
- Die Daten sind immer der Import plus alle Schritte. Ändern, verschieben oder ausschalten
  berechnet ab dort neu.
- Ein Katalog gültiger Kombinationen schränkt die Auswahl ein, blockiert aber nie: Abweichungen
  werden nur markiert.
- Export als Replacement-Tabelle (CSV) oder Datenpunkttabelle (XLSX oder JSON).

Bedienung: [Benutzerhandbuch](docs/user/USER-GUIDE.md).

## Starten

Node 24+ und [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm start
```

Zum Ausprobieren `examples/ede/demo_devices_ede.csv` importieren.

## Aufbau

```
apps/wizard/              Electron-App (main, preload, renderer, shared, e2e-Tests)
packages/mapping-engine/  die Engine: reines TypeScript, ohne Ein-/Ausgabe, mit Konformitäts-Korpus
packages/plugin-host/     prüft und führt Referenzdaten-Plugins zusammen
plugins/                  mitgelieferte Plugins: AMEV 2026, DiLT 2026
data/                     BACnet-Objekttypen und -Einheiten
examples/                 Plugin-Vorlage und Demo-EDE-Export
docs/user/                Benutzerhandbuch (auch die Hilfe in der App)
```

Namensstandards kommen als reine Daten-Plugins; eigene Keys lassen sich so ergänzen, siehe
[`examples/plugin-template`](examples/plugin-template/README.md).

## Unsignierte Releases installieren

Die Releases sind nicht code-signiert.

- **macOS:** App einmal starten, dann **Systemeinstellungen → Datenschutz & Sicherheit → Trotzdem
  öffnen**. Oder: `xattr -dr com.apple.quarantine "/Applications/BACtwin Wizard.app"`
- **Windows:** SmartScreen → **Weitere Informationen → Trotzdem ausführen**. Mit AppLocker oder
  WDAC muss die IT die Datei freigeben.
- **Linux:** `sudo apt install ./bactwin-wizard_*_amd64.deb`

Download prüfen:

```bash
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify <Datei> --repo DiLTAnalytics/dilt-bactwin-wizard
```

## Lizenz und Marken

Software, Plugins und Referenzdaten: [AGPL-3.0-only](LICENSES/AGPL-3.0-only.txt). Dokumentation:
[CC-BY-4.0](LICENSES/CC-BY-4.0.txt). Details in [`LICENSING.md`](LICENSING.md).

BACtwin, AMEV, BACnet (ASHRAE) und Project Haystack sind Namen bzw. Marken ihrer Inhaber, werden nur
beschreibend verwendet und sind mit diesem Projekt nicht verbunden.

## Förderung

Das Open Source Tool wurde im Rahmen des FFG Projekts BOSS (FO99992319) erstellt. Dieses Projekt wird
aus Mitteln der FFG gefördert ([www.ffg.at](https://www.ffg.at)). Die FFG ist die zentrale nationale
Förderorganisation und stärkt Österreichs Innovationskraft.

## Mitwirken

Siehe [`CONTRIBUTING.md`](CONTRIBUTING.md). Sicherheitsprobleme über [`SECURITY.md`](SECURITY.md),
nie als öffentliches Issue.
