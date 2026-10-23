# BACtwin Wizard - Benutzerhandbuch

## 1. Worum es geht

Eine EDE-Datei enthält die Datenpunkte einer Gebäudeautomation mit integratorspezifischen Namen.
Das Werkzeug gibt jedem relevanten Datenpunkt einen **BACtwin-Namen** aus Standardbausteinen
(Gewerk, Anlage, Baugruppe, Medium, Betriebsmittel, Funktion, Nummern).

Gearbeitet wird in Gruppen: Datenpunkte filtern, der Gruppe die Bausteine zuweisen, nächste Gruppe.
Jede Zuweisung ist ein Schritt der **Mapping-Sequenz**; die Daten ergeben sich immer aus dem Import
plus allen Schritten.

## 2. Projekt und EDE-Dateien

- **Neues Projekt…** fragt nach dem Ort der Projektdatei. **Projekt öffnen…** lädt eine; auf dem
  Startbildschirm stehen die zuletzt geöffneten.
- **EDE-Dateien** (Werkzeugleiste) zeigt die EDE-Dateien des Projekts. **EDE-Dateien hinzufügen…**
  importiert weitere; **Datei → EDE hinzufügen…** (Cmd/Strg+I) geht direkt zur Dateiauswahl.
- Device-Objekte (Objekttyp 8) werden wie jeder andere Datenpunkt importiert und übersetzt.
- Der Import meldet, was er nicht übernimmt: Zeilen mit `#` am Anfang, ungültige Zellen, Werte ohne
  Spaltenüberschrift, Zeichen in Windows-1252 in einer UTF-8-Datei. Doppelte Spalten oder ein nicht
  geschlossenes Anführungszeichen lehnen die Datei ab.
- Eine zweite Datei gleichen Namens aus einem anderen Ordner wird abgelehnt.
- Datenpunkte, die schon im Projekt sind, werden beim Import übersprungen und gemeldet. Eine Datei,
  die schon in der Liste steht, wird neu eingelesen statt doppelt aufgenommen.
- Alle Schritte gelten sofort auch für neu importierte Datenpunkte.

Status je Datei: **aktuell**, **geändert**, **nicht gefunden**, **nicht erfasst** (Ort unbekannt).

- **Neu einlesen** übernimmt eine geänderte Datei: neue EDE-Werte, neue Datenpunkte kommen dazu,
  fehlende werden markiert, nicht gelöscht. Die Zuweisungen bleiben.
- **Suchen…** gibt den neuen Ort einer verschobenen Datei an.
- **⋯ → Durch andere Datei ersetzen…** liest eine Datei mit anderem Namen an Stelle der alten ein.
- **⋯ → Aus Projekt entfernen…** entfernt die Datei mit ihren Datenpunkten. Die Schritte bleiben.
  Entfernen und wieder hinzufügen räumt markierte, nicht mehr vorhandene Datenpunkte ab.

Ändert sich eine EDE-Datei bei offenem Projekt oder verschwindet sie, erscheint eine Meldung mit
**Anzeigen**. Eingelesen wird nur auf **Neu einlesen**.

## 3. Einstellungen

**Projekteigenschaften** (Klick auf den Projektnamen oben links):
- **Projektname**
- **Referenzdaten-Plugins** - welche Namensstandards (z.B. AMEV 2026, DiLT 2026) das Projekt nutzt.
  Sie werden mit dem Projekt gespeichert. Ein hier nicht installiertes Plugin bleibt im Projekt, bis
  Sie es abschalten.

**App-Einstellungen** (Zahnrad oben rechts):
- **Darstellung** - Hell, Dunkel oder System.
- **Plugins für neue Projekte**

## 4. Das Fenster

- **Logo oben links:** zurück zur Startseite; schließt das Projekt.
- **Links:** die Mapping-Sequenz (§9).
- **Oben:** der Schritt-Editor (§5).
- **Mitte:** die Tabelle, mit offenem Schritt als Vorschau (§6).
- **Rechts:** der angeklickte Datenpunkt (§7).
- **Unten:** Anzahl, Fortschritt, gesetzte Felder und die Zähler Fehler, Doppelt, Zu prüfen, Nicht
  relevant. Ein Klick filtert die Tabelle darauf.

## 5. Schritte

**+ Neuer Schritt** (Strg+Umschalt+N, Mac ⌘⇧N) legt einen Schritt an, ein Klick auf einen Schritt
öffnet ihn. **Duplizieren** (Strg+D, Mac ⌘D) legt eine Kopie des gewählten Schritts direkt darunter
als neuen Schritt an; nur noch die Felder ändern, die anders sind, dann **Übernehmen**.

**Wenn** - Bedingungen, die alle zutreffen müssen: **Feld**, **Vergleich** (Regex, gleich, leer,
ja/nein) und Wert. **NOT** hinter dem Vergleich kehrt um, **Aa** beachtet Groß-/Kleinschreibung. Neben jeder Bedingung
steht, wie viele Datenpunkte sie allein trifft. Was eine Bedingung auf Objektname oder Beschreibung
trifft, ist in der Tabelle in ihrer Farbe markiert (Punkt links). Der Ziehgriff oder Alt+↑/↓ ordnet
die Bedingungen um; das ändert nur die Anzeige.

**Dann** - eine Zeile pro Feld (**+ Feld**), in dieser Reihenfolge geschrieben:
- **Wert aus der Liste** (Key oder Bezeichnung tippen, Enter), eine **Nummer**, oder
  **### nicht vorhanden**, wenn der Baustein hier nicht zutrifft.
- **Aus Feld übernehmen** (Nummern und Ort): ein Regex-Muster holt den Wert aus dem Objektnamen oder
  einem anderen Feld. `Ahu(\d+)` mit `$1` schreibt `01` aus `Ahu01`; `L$1` schreibt `L01`.
- **Teil eines Ort-Werts ändern:** Quelle **dieses Feld**, den Rest in Klammern festhalten.
  `^(..)..(.*)$` mit `$1OG$2` macht aus `B1EG01` `B1OG01`.
- **+ Quelle** setzt einen Wert aus mehreren Feldern zusammen; die Gruppen werden über alle Quellen
  durchgezählt (`$1$2$3`).
- Passt ein Muster nicht, wird der Datenpunkt übersprungen.
- **Nicht relevant**, **Prüfen** und **Kommentar** kommen ebenfalls über **+ Feld**.

**Angebotene Keys** (oben in **Dann**) bestimmt nur, was die Liste anbietet:
- **Facilimind** - nur Werte, die die Keys-Combinations für die ganze Gruppe erlauben (Standard).
- **Gewerk** - Werte, die zum Gewerk passen.
- **alle** - keine Einschränkung.

> **Führung, keine Sperre.** Jeder gewählte oder getippte Wert wird geschrieben. Verstößt er gegen
> die Keys-Combinations, wird der Datenpunkt danach markiert (§8).

**Übernehmen · 8** speichert den Schritt; die Zahl sagt, wie viele Datenpunkte er trifft. Jeder
Schritt braucht einen Namen. Bis dahin ist er ein Entwurf (●): Die Tabelle zeigt die Wirkung,
geändert ist nichts. **Verwerfen** stellt den gespeicherten Stand wieder her. Entwürfe bleiben beim Wechsel zu einem anderen Schritt erhalten,
aber nicht über das Schließen hinaus; die App fragt vorher.

## 6. Die Tabelle

Mit offenem Schritt:
- **Getroffen** - neuer Wert, alter durchgestrichen daneben. **Nur betroffene Spalten** blendet den
  Rest aus.
- **Knapp verfehlt** - Datenpunkte, die genau eine Bedingung nicht erfüllen, mit ✓/✗ je Bedingung.
- **Nicht getroffen** - auf den Daten vor diesem Schritt oder auf dem Import.
- **Endergebnis** - alle Datenpunkte nach allen übernommenen Schritten; der Schritt bleibt offen, sein
  Entwurf zählt nicht mit.

Ohne offenen Schritt: alle Datenpunkte nach allen Schritten.

Der **Ansichtsfilter** (Suche in Objektname und Beschreibung, **Fehler**, **Doppelt**, **Zu prüfen**) ändert nur die Anzeige,
nie einen Schritt. Der Suchbegriff ist blau umrandet. Ein Klick auf eine Spaltenüberschrift sortiert; Rechtsklick fixiert oder setzt die
Breite zurück.

Balken vorn: rot (Fehler oder doppelt), grün (vollständig), gelb (in Arbeit).
Symbole: durchgestrichenes Auge (nicht relevant), Fähnchen (zu prüfen).

## 7. Ein Datenpunkt

Klick auf eine Zeile öffnet ihn rechts; ↑/↓ blättern, Escape schließt. Meldungen stehen unter dem
Feld, das sie betreffen. Oben steht der **Verlauf**:
jeder Schritt, der ihn geändert hat; ein Klick öffnet den Schritt. Eine Korrektur hier wird mit
**Setzen** ein eigener Schritt für nur diesen Datenpunkt, vorbelegt als „Korrektur <Objektname>“.

## 8. Fehler und doppelte Namen

- **Fehler:** Ansichtsfilter **Fehler**. Ursachen: unbekannter oder veralteter Key, unvollständiger
  Name, nicht in den Keys-Combinations.
- **Doppelt:** Ansichtsfilter **Doppelt**, Namen eindeutig machen (meist eine fehlende Nummer). Nur
  vollständige Namen zählen.
- **Nicht relevant:** Datenpunkte ohne BACtwin-Namen per Schritt so markieren; sie zählen dann nicht
  mehr zum Fortschritt.

## 9. Die Mapping-Sequenz

Die Sequenz ist das eigentliche Ergebnis: Korrigieren Sie sie, der Export folgt. Ein späterer
Schritt gewinnt, wenn zwei dasselbe Feld setzen. Markiert wird das am Schritt mit **überschreibt 3**
und **überschrieben von 7** (rot: alle seine Werte werden überschrieben) und in der Zelle mit einem
Stapel-Symbol.

Jeder Schritt zeigt Name, geänderte/getroffene Datenpunkte (`120/134`), **Wenn** und **Dann**, einen
Schalter zum Ausschalten und beim Überfahren Duplizieren und Löschen. Ziehgriff oder Alt+↑/↓ verschiebt.

**Sequenzdateien.** Die Schritte liegen in Dateien neben oder außerhalb des Projekts, z.B. gemeinsame
Regeln für mehrere Projekte (über Git geteilt). Sie laufen von oben nach unten.
- Die erste entsteht mit dem ersten Schritt: `<Projekt>.sequence.json`.
- **⋯ → Neue Sequenzdatei…** legt eine leere an, **⋯ → Sequenzdateien verknüpfen…** hängt
  vorhandene an (mehrere nach Namen sortiert).
- Kopfzeile: Pfeil klappt zu, Ziehgriff verschiebt die Datei, **+** legt einen Schritt am Ende an,
  **⋯** bietet **Verknüpfung entfernen** (die Datei bleibt unverändert).
- **Neuer Schritt** landet hinter dem gewählten. Bis zum Übernehmen steht er gestrichelt dort;
  **×** verwirft ihn.
- Schritte lassen sich in andere Dateien ziehen, auf eine Kopfzeile gezogen an deren Anfang.
- Änderungen werden sofort in die Datei geschrieben, bei gemeinsamen Dateien also für alle Projekte.
- **nicht gefunden:** Klick darauf sucht die verschobene Datei.

**Änderungen von außen** (Git, anderer Editor): Die Datei wird neu geladen und neu berechnet, mit
Meldung. Entwürfe aus dieser Datei werden verworfen. Eine unlesbare Datei (z.B. mit Git-Konflikten)
behält ihre bisherigen Schritte.

**gelöscht:** Die Schritte laufen weiter, lassen sich aber nicht ändern. Klick darauf: **Wieder
speichern**, **Speichern unter…**, **Datei suchen…** oder **Verknüpfung entfernen**.

**Git-Punkt** hinter dem Namen: gefüllt = seit dem letzten Commit geändert, hohl = noch nicht in Git.

**Dateien aus einer neueren Version** öffnet die App nicht, damit beim Speichern nichts verloren geht.
Dann die neueste Version installieren.

## 10. Export

**Exportieren…** öffnet einen Dialog:
- **Format:** **Replacement-Tabelle (CSV)** (alter Name → BACtwin-Name, mit Kommentar) oder
  **Datenpunkttabelle** (alle Felder), als **XLSX** (flach, eine Spalte je Feld) oder **JSON**
  (verschachtelt, ein Objekt je Datenpunkt, Zahlen und Ja/Nein typisiert).
- **Datenpunkte:** **Alle** oder **Gefilterte** (was der Ansichtsfilter zeigt), bei der Datenpunkttabelle
  auch **Vollständige** (mit vollständigem BACtwin-Namen), jeweils mit Anzahl. Die CSV lässt Punkte ohne BACtwin-Namen und Device-Objekte (Objekttyp 8, ohne Zeitreihe) aus; der Dialog sagt vorher, wie viele.

## 11. Speichern

Ein Projekt mit Datei speichert sich selbst (**Gespeichert** in der Werkzeugleiste). Die Datei
enthält die importierten Daten und die Verweise auf die Sequenzdateien. Nicht übernommene Schritte
werden nicht gespeichert. **Datei → Speichern unter…** speichert eine Kopie.

- **Projektdatei von außen geändert:** Das Speichern wartet. **Neu laden** übernimmt die äußere
  Fassung, **Meine Version behalten** überschreibt sie.
- **Projektdatei gelöscht:** **Wieder speichern**, **Speichern unter…** oder **Schließen**.

## 12. Kurzreferenz

| Ziel | Weg |
|---|---|
| Projekt anlegen | **Neues Projekt…**, dann **EDE-Dateien → EDE-Dateien hinzufügen…** |
| Geänderte EDE-Datei übernehmen | **EDE-Dateien**, **Neu einlesen** |
| Projektname, Plugins | Projektname oben links |
| Darstellung, Plugins für neue Projekte | Zahnrad |
| Einer Gruppe Namen geben | **+ Neuer Schritt**, **Wenn**, **Dann**, **Übernehmen** |
| Sehen, was ein Filter verfehlt | **Knapp verfehlt** / **Nicht getroffen** |
| Ähnlichen Schritt anlegen | Schritt wählen, Strg+D (⌘D) |
| Schritt vorübergehend weglassen | Schalter des Schritts |
| Warum heißt ein Datenpunkt so? | Zeile anklicken, **Verlauf** |
| Gemeinsame Regeln nutzen | **⋯ → Sequenzdateien verknüpfen…** |
| Ergebnis übergeben | **Exportieren ▾** |
