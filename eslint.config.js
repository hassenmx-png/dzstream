import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Règles react-hooks v6 (compiler) trop strictes pour les patterns de
      // récupération de données existants : avertissement, pas erreur —
      // sinon la porte de publication échoue sur du code sain et éprouvé.
      'react-hooks/set-state-in-effect': 'warn',
      // Diagnostic compilateur (bail de mémoïsation) : avertissement.
      'react-hooks/preserve-manual-memoization': 'warn',
      // Les fichiers shadcn/ui exportent volontairement variantes + helpers :
      // avertissement uniquement.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
