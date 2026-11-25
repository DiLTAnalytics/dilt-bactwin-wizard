import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDeb } from '@electron-forge/maker-deb'
import { execFileSync } from 'node:child_process'
import { renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'

import { writeNotices } from './vite.notices.js'

/** Electron's licence and Chromium's notices sit beside the app bundle by default; shipped as resources they are inside it. */
const electronDist = join(dirname(createRequire(import.meta.url).resolve('electron')), 'dist')
const thirdPartyLicenses = [
  join(electronDist, 'LICENSE'),
  join(electronDist, 'LICENSES.chromium.html'),
]

const repoRoot = join(import.meta.dirname, '..', '..')
// Bundled so Help works offline; same build as the Pages site (see scripts/build-docs.mjs).
const docsSite = join(repoRoot, 'docs-site')

const platformNames: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' }

/** BACtwin-Wizard-<version>-<os>-<arch>.<ext>; the Windows installer ends in -Setup.exe. Squirrel's RELEASES and .nupkg keep their names. */
function packageName(file: string, version: string, platform: string, arch: string): string | undefined {
  const ext = extname(file)
  if (!['.dmg', '.zip', '.deb', '.exe'].includes(ext)) return undefined
  const stem = `BACtwin-Wizard-${version}-${platformNames[platform] ?? platform}-${arch}`
  return ext === '.exe' ? `${stem}-Setup.exe` : stem + ext
}

const config: ForgeConfig = {
  hooks: {
    // Always rebuilt: a stale or missing docs-site would silently fall back to the website.
    prePackage: async () => {
      execFileSync('node', [join(repoRoot, 'scripts', 'build-docs.mjs')], { stdio: 'inherit' })
    },
    // buildPath is resources/app: the notices go beside it, readable outside the asar.
    packageAfterCopy: async (_config, buildPath) => {
      writeNotices(dirname(buildPath))
      rmSync(join(buildPath, '.vite', 'notices'), { recursive: true, force: true })
    },
    postMake: async (_config, results) =>
      results.map((result) => ({
        ...result,
        artifacts: result.artifacts.map((file) => {
          const name = packageName(basename(file), result.packageJSON.version, result.platform, result.arch)
          if (!name) return file
          const target = join(dirname(file), name)
          renameSync(file, target)
          return target
        }),
      })),
  },
  packagerConfig: {
    name: 'BACtwin Wizard',
    executableName: 'bactwin-wizard',
    appBundleId: 'at.dilt.bactwin-wizard',
    // Extensionless on purpose: packager appends the right one per platform (.icns, .ico).
    icon: 'assets/icon',
    // Reference data and plugins ship unpacked, so users can inspect and add them.
    extraResource: ['../../plugins', '../../data', docsSite, ...thirdPartyLicenses],
    asar: true,
    prune: true,
    protocols: [{ name: 'BACtwin Projekt', schemes: ['bactwin'] }],
  },
  makers: [
    new MakerDMG({ format: 'ULFO', icon: 'assets/icon.icns' }, ['darwin']),
    // Both would otherwise name files after the package, whose scope slash breaks their paths.
    new MakerSquirrel({
      name: 'bactwin_wizard', exe: 'bactwin-wizard.exe', setupExe: 'BACtwin-Wizard-Setup.exe', setupIcon: 'assets/icon.ico',
      authors: 'DiLT Analytics GmbH',
    }),
    new MakerDeb({ options: { name: 'bactwin-wizard', bin: 'bactwin-wizard', productName: 'BACtwin Wizard', categories: ['Science'] } }),
    new MakerZIP({}, ['darwin', 'linux']),
  ],
  plugins: [
    new VitePlugin({
      // `pnpm start` restarts the app when the main process is rebuilt.
      hotRestart: true,
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
}

export default config
