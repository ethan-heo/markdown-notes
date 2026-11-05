const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

(async function () {
  try {
    await runTests({
      version: process.env.VSCODE_VERSION || '1.143.1',
      extensionDevelopmentPath: path.resolve(__dirname, '../..'),
      extensionTestsPath: path.resolve(__dirname, 'extension.test.js'),
      launchArgs: ['--disable-workspace-trust', '--remote-debugging-port=9333']
    });
  } catch (error) {
    console.error('Extension Host E2E failed:', error);
    process.exitCode = 1;
  }
}());
