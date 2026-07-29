import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    semi: true,
    arrowParens: true,
    braceStyle: '1tbs',
    quoteProps: 'as-needed',
  }),
  {
    rules: {
      '@typescript-eslint/no-shadow': 'error',
      curly: 'error',
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', 30],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
    },
  },
  {
    files: ['src/**/*.ts', 'bin/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
];
