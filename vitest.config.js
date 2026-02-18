// Vitest configuration
module.exports = {
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./test.setup.ts'],
    env: {
      ZOTERO_API_KEY: 'test_api_key',
      ZOTERO_USER_ID: '123456',
      DATABASE_PATH: ':memory:',
    },
  },
};
