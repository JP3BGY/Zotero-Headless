// Vitest configuration
module.exports = {
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
};
