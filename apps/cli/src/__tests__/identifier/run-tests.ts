/**
 * 标识符功能测试运行器
 * 
 * 运行方式:
 *   pnpm test:identifier
 *   pnpm test:identifier:unit
 *   pnpm test:identifier:integration
 *   pnpm test:identifier:cli
 */

import { spawn } from 'child_process';
import * as path from 'path';

const testPath = path.join(__dirname);

// 测试配置
const vitestConfig = {
  testEnvironment: 'node',
  globals: true,
  setupFiles: [],
  include: [
    '**/__tests__/identifier/**/*.test.ts',
  ],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    include: [
      'apps/cli/src/identifier/**/*.ts',
    ],
  },
};

console.log('🧪 运行标识符功能测试...\n');

// 根据参数运行不同类型的测试
const args = process.argv.slice(2);
const testType = args[0] || 'all';

let testFiles: string[] = [];

switch (testType) {
  case 'unit':
    testFiles = [
      path.join(testPath, 'parser.test.ts'),
      path.join(testPath, 'converter.test.ts'),
    ];
    console.log('📋 运行单元测试...\n');
    break;
  case 'integration':
    testFiles = [path.join(testPath, 'fetcher.integration.test.ts')];
    console.log('🔗 运行集成测试...\n');
    break;
  case 'cli':
    testFiles = [path.join(testPath, 'cli.test.ts')];
    console.log('🖥️ 运行 CLI 端到端测试...\n');
    break;
  case 'all':
  default:
    testFiles = [
      path.join(testPath, 'parser.test.ts'),
      path.join(testPath, 'converter.test.ts'),
      path.join(testPath, 'fetcher.integration.test.ts'),
      path.join(testPath, 'cli.test.ts'),
    ];
    console.log('🧪 运行所有测试...\n');
    break;
}

// 使用 vitest 运行测试
const vitest = spawn('npx', [
  'vitest',
  'run',
  '--reporter=verbose',
  ...testFiles,
], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '../../../..'),
});

vitest.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ 所有测试通过!');
  } else {
    console.log(`\n❌ 测试失败，退出码: ${code}`);
  }
  process.exit(code || 0);
});
