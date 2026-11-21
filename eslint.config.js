import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: tseslint.configs.strictTypeChecked,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, __API_BASE__: 'readonly', __DEV_BUILD__: 'readonly' },
    },
  },
  {
    // Con vi.fn() y los dobles de los tests, `expect(api.metodo)` no es un uso real del método.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
