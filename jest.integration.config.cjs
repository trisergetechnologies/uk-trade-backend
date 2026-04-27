/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/api.integration.test.js'],
  setupFiles: ['<rootDir>/tests/integration-env.js'],
  testTimeout: 60000,
};
