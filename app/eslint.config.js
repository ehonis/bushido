// ESLint for the web app (#98). Two jobs, both cheap and both real failures this
// codebase has had: a name that is not defined (an import lost in a move renders
// nothing until the line runs), and the rules of hooks. `exhaustive-deps` is on,
// and a suppression must say why after `--` (`local/disable-says-why`): ten of
// them sat unexplained, and nothing checked them, before this file existed.
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

/** An `eslint-disable…` comment with no ` -- reason` after its rule. */
const disableSaysWhy = {
  meta: { type: 'problem', messages: { why: 'Say why after `--`: {{text}}' } },
  create(context) {
    return {
      Program() {
        for (const c of context.sourceCode.getAllComments()) {
          const text = c.value.trim()
          if (/^eslint-disable/.test(text) && !/\s--\s+\S/.test(text)) context.report({ loc: c.loc, messageId: 'why', data: { text } })
        }
      },
    }
  },
}

export default [
  { ignores: ['node_modules/**', 'dist/**', '**/.*.mjs', '../dist/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks, local: { rules: { 'disable-says-why': disableSaysWhy } } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'local/disable-says-why': 'error',
    },
  },
]
