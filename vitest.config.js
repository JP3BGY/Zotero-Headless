// Vitest configuration
module.exports = {
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./test.setup.ts'],
    env: {
      ZOTERO_API_KEY: 'test_api_key',
      ZOTERO_USER_ID: '123456',
      DATABASE_PATH: ':memory:',
    },
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    reportsDirectory: './coverage',
    // Only measure src files, exclude dist and test files
    include: [
      'packages/*/src/**/*.ts',
      'apps/*/src/**/*.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/test-*.ts',
      '**/dist/**',
      '**/build/**',
    ],
  },
};
