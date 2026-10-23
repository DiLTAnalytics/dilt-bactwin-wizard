import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// The renderer and shared code run sandboxed; Electron and Node belong in main/preload.
const SANDBOXED = [
  { group: ['electron', 'electron/*'], message: 'Electron is main/preload only; go through window.bactwin.' },
  { group: ['node:*'], message: 'Node APIs are main-process only.' },
  // Types only: the renderer derives its IPC call types from main/ipc.ts.
  { group: ['**/main/*', '**/main/**'], allowTypeImports: true, message: 'Import main-process code as types only.' },
]

/** One restriction rule per file group. A later rule replaces an earlier one, so each lists all its patterns. */
const restrict = (files, patterns) => ({
  files,
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] },
})

// Only architectural boundaries for now; style rules can be added later.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/.vite/**', 'docs-site/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    // Registered so existing disable directives resolve; its rules are not enabled yet.
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  restrict(['apps/wizard/src/renderer/**/*.{ts,tsx}', 'apps/wizard/src/shared/**/*.ts'], SANDBOXED),
  // Shared UI knows nothing of the features that use it.
  restrict(['apps/wizard/src/renderer/ui/**/*.{ts,tsx}'], [
    ...SANDBOXED,
    { regex: '(^@/features/|/features/)', message: 'ui/ must not import features/.' },
  ]),
  // Features talk through stores, queries and ui/, never by importing each other.
  restrict(['apps/wizard/src/renderer/features/**/*.{ts,tsx}'], [
    ...SANDBOXED,
    { regex: '^@/features/', message: 'Features must not import each other.' },
    { regex: '^\\.\\./[^.]', message: 'Features must not import each other.' },
  ]),
  // The project layer runs headless (tests, and a future worker): no Electron, no shell modules.
  restrict(['apps/wizard/src/main/project/**/*.ts'], [
    { group: ['electron', 'electron/*'], message: 'project/ must not use Electron; the shell in main/ does.' },
    { regex: '^\\.\\./(?!\\.\\./shared/)', message: 'project/ must not import the Electron shell in main/.' },
  ]),
)
