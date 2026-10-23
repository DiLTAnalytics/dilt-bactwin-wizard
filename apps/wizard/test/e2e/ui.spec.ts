/** The interface itself, clicked through as a user would (smoke.spec.ts drives IPC directly). */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEMO_EDE = join(APP, '..', '..', 'examples', 'ede', 'demo_devices_ede.csv')
let app: ElectronApplication
let page: Page
let userData: string
const errors: string[] = []

async function answerDialogs(answer: { open?: string[]; save?: string; button?: number }) {
  await app.evaluate(({ dialog }, { open, save, button }) => {
    if (open) dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: open })) as never
    if (save) dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as never
    if (button !== undefined) dialog.showMessageBox = (async () => ({ response: button, checkboxChecked: false })) as never
  }, answer)
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'bactwin-ui-'))
  app = await electron.launch({ args: [join(APP, '.vite', 'build', 'main.cjs'), `--user-data-dir=${userData}`], cwd: APP })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  await expect(page.locator('body')).toContainText('BACtwin', { timeout: 20_000 })
})

test.afterAll(async () => {
  await answerDialogs({ button: 1 }) // "Don't save" on close
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const table = () => page.locator('table.border-collapse')
const fieldRow = () => page.locator('div.flex.min-w-0.items-center').filter({ has: page.locator('select[aria-label="BACtwin-Feld"]') }).first()

test('create a project, record a step with a preview, inspect a point and switch the step off', async () => {
  // Without a project the start screen shows instead of the workspace.
  await expect(page.getByText('Kein Projekt geöffnet', { exact: true }).first()).toBeVisible()

  // A new project asks where it goes; then add a file in the EDE files dialog (the demo file is clean, so no warnings dialog opens).
  await answerDialogs({ save: join(userData, 'ui.bactwin') })
  await page.getByRole('button', { name: 'Neues Projekt…' }).click()
  await expect(page.getByRole('button', { name: 'EDE-Dateien' })).toBeEnabled()
  await answerDialogs({ open: [DEMO_EDE] })
  await page.getByRole('button', { name: 'EDE-Dateien' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'EDE-Dateien hinzufügen…' }).click()
  const files = page.getByRole('dialog')
  await expect(files.getByRole('row', { name: /demo_devices_ede\.csv/ })).toContainText('aktuell')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await files.getByRole('button', { name: 'Schließen' }).last().click()
  const rows = table().locator('tbody tr[data-point-key]')
  await expect(rows.first()).toContainText('XX-DILT', { timeout: 10_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // A column group is switched on from the column menu.
  await page.getByRole('button', { name: 'Spalten' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Status und Kommentar' }).click()
  await page.keyboard.press('Escape')
  await expect(table().locator('thead th', { hasText: 'Kommentar' })).toBeVisible()

  // A new step: one condition, gewerk HZG picked by searching the key list; the table previews the hits.
  await page.getByRole('button', { name: 'Neuer Schritt' }).last().click()
  await page.getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await page.getByPlaceholder('Wert', { exact: true }).fill('HH4')
  await page.getByRole('radio', { name: 'alle' }).click()
  await fieldRow().locator('select[aria-label="BACtwin-Feld"]').selectOption('gewerk')
  await fieldRow().locator('button[role="combobox"]').click()
  await page.getByPlaceholder('Suchen…', { exact: true }).fill('HZG')
  await expect(page.getByRole('option', { name: /^HZG \[.+\]/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('radio', { name: /^Getroffen \d+/ })).toBeVisible()
  await expect(rows.first()).toContainText('HZG')
  await expect(page.getByText(/alle erfüllt: \d+/)).toBeVisible()
  // The apply button names how many points the step hits.
  await expect(page.getByRole('button', { name: /^Übernehmen · \d+$/ })).toBeVisible()

  // Each condition marks its matches in its own colour, in the name and the description.
  await page.getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await page.getByRole('combobox', { name: 'Feld', exact: true }).nth(1).selectOption('ede.description')
  await page.getByPlaceholder('Wert', { exact: true }).nth(1).fill('Temperatur')
  await expect(table().locator('mark.bg-mark-1').first()).toHaveText('HH4')
  await expect(table().locator('mark.bg-mark-2').first()).toHaveText('Temperatur')
  // Reordering conditions only changes their colours.
  await page.getByRole('button', { name: /^Ziehen oder Alt/ }).nth(1).press('Alt+ArrowUp')
  await expect(page.getByPlaceholder('Wert', { exact: true }).first()).toHaveValue('Temperatur')
  await expect(table().locator('mark.bg-mark-1').first()).toHaveText('Temperatur')
  await page.getByRole('button', { name: 'Bedingung entfernen' }).first().click()
  await expect(table().locator('mark.bg-mark-1').first()).toHaveText('HH4')

  // "Endergebnis" lists every point after the applied steps while the step stays open.
  await page.getByRole('radio', { name: 'Endergebnis' }).click()
  await expect(page.getByText(/^31 Datenpunkte$/)).toBeVisible()
  await expect(page.getByLabel('Name des Schritts')).toBeVisible()
  // The view search marks its term too, behind the conditions' colours.
  await page.getByLabel('Objektname oder Beschreibung suchen').fill('temperatur')
  await expect(table().locator('mark.ring-accent').first()).toHaveText('Temperatur')
  await page.getByLabel('Objektname oder Beschreibung suchen').fill('')
  await page.getByRole('radio', { name: /^Getroffen/ }).click()

  // "+ Feld" offers the index numbers too.
  await page.getByRole('button', { name: 'Feld', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /aggregat-nummer/i })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('Name des Schritts').fill('ui check')
  await page.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(page.getByText(/Schritt hinzugefügt/)).toBeVisible()

  // The recorded step reads correctly in the sequence column.
  const steps = page.locator('ol > li.group')
  await expect(steps).toHaveCount(1)
  await expect(steps.first()).toContainText('HH4')
  await expect(steps.first()).toContainText('HZG')
  await expect(steps.first()).toContainText('ui check')

  // Duplicating opens a copy as the new step right below; applied, it is a second step with the same Wenn and Dann.
  await steps.first().getByRole('button', { name: 'Schritt duplizieren' }).click()
  await expect(page.getByLabel('Name des Schritts')).toHaveValue('ui check (Kopie)')
  // A second copy would replace the unapplied one, so it asks; "Abbrechen" keeps it.
  await page.getByLabel('Name des Schritts').fill('ui check (Kopie) 2')
  await answerDialogs({ button: 1 })
  await steps.first().getByRole('button', { name: 'Schritt duplizieren' }).click()
  await expect(page.getByLabel('Name des Schritts')).toHaveValue('ui check (Kopie) 2')
  await page.getByLabel('Name des Schritts').fill('ui check (Kopie)')
  await page.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(1)).toContainText('ui check (Kopie)')
  await expect(steps.nth(1)).toContainText('HH4')
  await expect(steps.nth(1)).toContainText('HZG')
  await answerDialogs({ button: 0 })
  await steps.nth(1).getByRole('button', { name: 'Schritt löschen' }).click()
  await expect(steps).toHaveCount(1)
  await steps.first().click()

  // Near misses list one column per condition.
  await page.getByRole('radio', { name: /Knapp verfehlt/ }).click()
  await page.getByRole('radio', { name: /^Getroffen/ }).click()

  // A row opens the docked inspector with the point's history; ↓ moves on; Escape closes it.
  await page.getByRole('button', { name: 'Schließen (Änderungen bleiben als Entwurf)' }).click()
  const hh4 = rows.filter({ hasText: 'HH4' }).first()
  await hh4.click()
  const detail = page.getByRole('complementary')
  await expect(detail.locator('button[role="combobox"]')).toHaveCount(8)
  await expect(detail.getByText('ui check')).toBeVisible()
  const firstName = await detail.locator('.font-mono').first().textContent()
  await page.keyboard.press('ArrowDown')
  await expect(detail.locator('.font-mono').first()).not.toHaveText(firstName ?? '')
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)

  // A correction in the inspector is a step named after the point, so it applies without typing a name.
  await hh4.click()
  const actionName = detail.getByLabel('Aktions-Name')
  await expect(actionName).toHaveValue(/^Korrektur XXDILT/)
  const pointName = (await actionName.inputValue()).replace('Korrektur ', '')
  await detail.getByRole('radiogroup', { name: 'Zu prüfen' }).getByRole('radio', { name: 'ja' }).click()
  await detail.getByRole('button', { name: /^Setzen/ }).click()
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(1)).toContainText(`Korrektur ${pointName}`)
  await expect(actionName).toHaveValue(`Korrektur ${pointName}`)
  await answerDialogs({ button: 0 })
  await steps.nth(1).getByRole('button', { name: 'Schritt löschen' }).click()
  await expect(steps).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)

  // Switching the step off takes its values away; switching it on brings them back.
  await steps.first().getByRole('switch').click()
  await expect(table()).not.toContainText('HZG')
  await steps.first().getByRole('switch').click()
  await expect(hh4).toContainText('HZG')

  // Export: a dialog with format and scope, the points per scope, and those the CSV leaves out named first.
  await page.getByRole('button', { name: 'Exportieren…' }).click()
  const exportDialog = page.getByRole('dialog')
  await exportDialog.getByRole('radio', { name: /Replacement-Tabelle/ }).click()
  await exportDialog.getByRole('radio', { name: /^Alle/ }).click()
  await expect(exportDialog.getByRole('radio', { name: /^Alle/ })).toContainText(/\d+/)
  await expect(exportDialog.getByText(/ohne BACtwin-Namen werden ausgelassen|Keiner davon hat einen vollständigen BACtwin-Namen/)).toBeVisible()
  await expect(exportDialog.getByRole('radio', { name: /^Gefilterte/ })).toBeDisabled()
  await expect(exportDialog.getByRole('radio', { name: /^Vollständige/ })).toHaveCount(0)
  await exportDialog.getByRole('radio', { name: /Datenpunkttabelle/ }).click()
  await expect(exportDialog.getByRole('radio', { name: /^Vollständige/ })).toBeVisible()
  await expect(exportDialog.getByText(/ausgelassen|wäre leer/)).toHaveCount(0)
  const xlsx = join(userData, 'export.xlsx')
  await answerDialogs({ save: xlsx })
  await exportDialog.getByRole('button', { name: 'Exportieren…' }).click()
  await expect(page.getByText(/Datenpunkte exportiert: export\.xlsx/)).toBeVisible()
  await expect(exportDialog).toHaveCount(0)
  expect(existsSync(xlsx)).toBe(true)
  // The same table as JSON: one nested object per point.
  await page.getByRole('button', { name: 'Exportieren…' }).click()
  await exportDialog.getByRole('radio', { name: 'JSON' }).click()
  const json = join(userData, 'export.json')
  await answerDialogs({ save: json })
  await exportDialog.getByRole('button', { name: 'Exportieren…' }).click()
  await expect(page.getByText(/Datenpunkte exportiert: export\.json/)).toBeVisible()
  const exported = JSON.parse(readFileSync(json, 'utf8')) as { ede: { object_name: string }; state: { ignore: boolean } }[]
  expect(exported.length).toBeGreaterThan(0)
  expect(typeof exported[0]!.ede.object_name).toBe('string')
  expect(typeof exported[0]!.state.ignore).toBe('boolean')

  // Settings opens and closes.
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: 'App-Einstellungen' }).click()
  await expect(dialog.getByText('App-Einstellungen', { exact: true })).toBeVisible()
  // DiLT builds on AMEV: switching AMEV off takes DiLT along, switching DiLT on brings AMEV back.
  await expect(dialog.getByText('braucht AMEV 2026')).toBeVisible()
  await dialog.getByRole('switch', { name: 'AMEV 2026' }).click()
  await expect(dialog.getByRole('switch', { name: 'DiLT 2026' })).toHaveAttribute('aria-checked', 'false')
  await expect(dialog.getByText('DiLT 2026 mit ausgeschaltet: braucht AMEV 2026.')).toBeVisible()
  await dialog.getByRole('switch', { name: 'DiLT 2026' }).click()
  await expect(dialog.getByRole('switch', { name: 'AMEV 2026' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Schließen' }).click()
  await expect(dialog).toHaveCount(0)

  // An EDE file is removed with its points after asking, and added again the same way as at the start.
  await page.getByRole('button', { name: 'EDE-Dateien' }).click()
  await dialog.getByRole('button', { name: /Weitere Aktionen/ }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['Durch andere Datei ersetzen…', 'Aus Projekt entfernen…'])
  await answerDialogs({ button: 0 })
  await page.getByRole('menuitem', { name: 'Aus Projekt entfernen…' }).click()
  await expect(dialog.getByText('demo_devices_ede.csv entfernt.')).toBeVisible()
  await expect(dialog.getByText(/Noch keine EDE-Dateien/)).toBeVisible()
  await answerDialogs({ open: [DEMO_EDE] })
  await dialog.getByRole('button', { name: 'EDE-Dateien hinzufügen…' }).click()
  await expect(dialog.getByRole('row', { name: /demo_devices_ede\.csv/ })).toContainText('aktuell')
  await dialog.getByRole('button', { name: 'Schließen' }).last().click()
  await expect(rows.first()).toContainText('XX-DILT')

  expect(errors).toEqual([])
})

test('the inspector, the view filter and the menu follow the project', async () => {
  const rows = table().locator('tbody tr[data-point-key]')
  const detail = page.getByRole('complementary')
  const menuEnabled = (id: string) => app.evaluate(({ Menu }, entry) => Menu.getApplicationMenu()?.getMenuItemById(entry)?.enabled, id)
  expect(await menuEnabled('importEde')).toBe(true)

  // The inspector shows the point as it is now: a step applied in the editor fills its fields at once.
  await rows.nth(1).click()
  await expect(detail.getByLabel('ort', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Neuer Schritt' }).first().click()
  await page.getByLabel('Name des Schritts').fill('Ort für alle')
  await page.getByRole('combobox', { name: 'BACtwin-Feld' }).first().selectOption('ort')
  await page.getByPlaceholder('Wert').last().fill('HALLE')
  await page.getByRole('button', { name: /^Übernehmen/ }).click()
  await expect(detail.getByLabel('ort', { exact: true })).toHaveValue('HALLE')
  await page.getByRole('button', { name: /^Schließen \(Änderungen/ }).click()

  // Another project starts unfiltered and with nothing selected.
  await page.getByPlaceholder(/Objektname oder Beschreibung/).fill('zzz')
  await expect(rows).toHaveCount(0)
  await answerDialogs({ save: join(userData, 'second.bactwin'), button: 0 })
  await page.getByRole('button', { name: 'Neu', exact: true }).click()
  await expect(page.getByPlaceholder(/Objektname oder Beschreibung/)).toHaveValue('')
  await expect(detail).toHaveCount(0)

  // Without a project the entries that act on one are off.
  await page.getByRole('button', { name: 'Startseite (schließt das Projekt)' }).click()
  await expect(page.getByText('Kein Projekt geöffnet', { exact: true }).first()).toBeVisible()
  for (const id of ['importEde', 'edeFiles', 'save', 'saveAs', 'projectProperties', 'export', 'newStep', 'linkSequence']) {
    expect(await menuEnabled(id), id).toBe(false)
  }
  expect(errors).toEqual([])
})
