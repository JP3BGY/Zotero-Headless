# Zotero-Headless TDD 执行计划

## 概述
此文档为Coding Agent提供具体的、可执行的测试列表，能够逐步迭代项目，每完成一批测试就能解锁新的功能特性。

---

## 第1步：强化核心单元测试 (Week 1)

### 1.1 冲突解决器增强测试
```bash
# 运行此批测试（应该失败，然后修复）
npm run test -- packages/sync-engine/src/__tests__/enhanced-conflict.test.ts
```

需要创建的测试文件：
```typescript
// enhanced-conflict.test.ts
describe('Enhanced Conflict Resolution', () => {
  test('resolve with field priorities', () => {
    // 某些字段优先使用远程版本（如DOI、URL）
  });
  
  test('partial resolution with conflicts', () => {
    // 部分字段解析成功，部分有冲突
    // 期望返回值包含 resolvedFields 和 unresolvedConflicts
  });
  
  test('deep object comparison', () => {
    // 嵌套对象、数组的深度比较
  });
});
```

### 1.2 可中断的CLI命令测试
```typescript
// cli/sync-command.test.ts
describe('Sync Command', () => {
  test('--dry-run flag shows changes', async () => {
    // 应该输出"将更新X个项目，删除Y个项目"
  });
  
  test('progress indicator updates in real-time', () => {
    // 进度条/百分比显示
  });
  
  test('Ctrl+C gracefully cancels sync', async () => {
    // SIGINT处理，清理临时状态
  });
});
```

---

## 第2步：集成测试基础设施 (Week 2)

### 2.1 Mock服务器设置
```bash
# 安装依赖
npm install msw --save-dev
npm install @mswjs/data --save-dev

# 创建mock服务器
mkdir packages/api/__mocks__
touch packages/api/__mocks__/zotero-server.js
```

```javascript
// zotero-server.js
import { setupServer } from 'msw/node';
import { factory, primaryKey } from '@mswjs/data';

// 内存中的Zotero模拟存储
export const mockDB = factory({
  items: {
    key: primaryKey(String),
    library: Number,
    version: Number,
    data: Object,
  },
  collections: {
    key: primaryKey(String),
    library: Number,
    name: String,
  }
});

export const server = setupServer(
  // 定义所有Zotero API路由
);
```

### 2.2 完整同步流测试
```typescript
// integration/sync-flow.test.ts
describe('Complete Sync Flow', () => {
  beforeAll(() => server.listen());
  afterAll(() => server.close());
  
  test('从空开始 -> 创建项目 -> 同步 -> 修改 -> 再次同步', async () => {
    // 完整生命周期测试
  });
  
  test('冲突的完整处理流程', async () => {
    // 自动选择、保存冲突、手动解决
  });
});
```

---

## 第3步：配置和用户测试 (Week 3)

### 3.1 配置文件系统测试
```typescript
// config/user-config.test.ts
describe('User Configuration', () => {
  test('多级配置覆盖优先级', async () => {
    // 1. 默认配置
    // 2. 用户主目录 .zotero-headless.json
    // 3. 项目目录 .zotero-headless.json  
    // 4. 环境变量
    // 5. CLI参数
  });
  
  test('配置热重载', async () => {
    // 修改配置文件，触发重新加载
  });
});
```

### 3.2 用户设置向导测试
```typescript
// cli/setup-wizard.test.ts  
describe('Setup Wizard', () => {
  test('指导用户获取API key', async () => {
    // 1. 打开Zotero API key页面的URL
    // 2. 指导用户复制粘贴
    // 3. 验证key有效性
  });
  
  test('首次运行的交互式配置', async () => {
    // inquirer.js 模拟用户输入
  });
});
```

---

## 第4步：高级功能测试 (Week 4)

### 4.1 批量操作测试
```typescript
// advanced/batch-operations.test.ts
describe('Batch Operations', () => {
  test('分批处理大库（>1000项目）', async () => {
    // 自动分批，避免内存溢出
  });
  
  test('增量同步优化', async () => {
    // 只同步自上次同步以来的变化
  });
});
```

### 4.2 插件系统测试
```typescript
// plugins/hook-system.test.ts
describe('Plugin Hook System', () => {
  test('pre-sync和post-sync钩子', async () => {
    // 允许在同步前后执行自定义逻辑
  });
  
  test('自定义字段转换器', async () => {
    // 插件可以添加自定义字段处理
  });
});
```

---

## 🎯 Coding Agent 工作流程模板

### 模板1：实现新功能
```yaml
任务: "添加zotero export功能"
前置条件: 
  - 已通过现有测试套件
  
步骤:
  1. 创建测试文件: export-command.test.ts
      - 测试export to BibTeX
      - 测试export to RIS
      - 测试format选项
  
  2. 运行新测试（应该失败）
      npm run test -- packages/cli/src/__tests__/export-command.test.ts
  
  3. 实现最小功能
      - 添加export命令
      - 实现BibTeX转换器
      - 实现RIS转换器
  
  4. 验证功能
      - 运行新测试（应该通过）
      - 运行完整测试套件（确保无回归）
```

### 模板2：修复bug
```yaml
任务: "修复429限流处理bug"
前置条件:
  - 已有重现的测试用例或报告
  
步骤:
  1. 添加专门测试此bug的测试
      test('handle consecutive 429 errors', async () => {
        // 模拟连续429错误
        mockServer.mock429(3); // 3次限流
        expect(sync()).resolves.not.toThrow();
      });
  
  2. 运行专门测试（应该失败）
  
  3. 调试和修复
      - 检查retry逻辑
      - 检查等待时间计算
  
  4. 修复验证
      - 专门测试通过
      - 现有测试套件通过
```

---

## 📈 测试覆盖率目标

按包分解：

### packages/database
- 当前: 30%（仅概念测试）
- 目标: 90%（真实数据库操作）
- 关键测试: 事务、迁移、索引

### packages/api  
- 当前: 50%（基本客户端）
- 目标: 85%（完整错误处理）
- 关键测试: 重试、限流、错误转换

### packages/sync-engine
- 当前: 70%（冲突解决）
- 目标: 95%（完整同步逻辑）
- 关键测试: 边界条件、并发情况

### packages/cli
- 当前: 0%
- 目标: 80%（所有命令）
- 关键测试: 用户交互、配置加载

---

## 🔄 持续集成策略

### GitHub Actions工作流：
```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
      
      - name: Fail if coverage < 85%
        run: npx nyc report --check-coverage --lines 85
  
  integration-tests:
    runs-on: ubuntu-latest  
    needs: unit-tests
    services:
      sqlite: # SQLite数据库
    steps:
      - name: Run integration tests
        env:
          ZOTERO_MOCK: "true"  # 使用mock，不调用真实API
        run: npm run test:integration
  
  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.event_name == 'push'  # 只对推送运行
    env:
      ZOTERO_TEST_API_KEY: ${{ secrets.ZOTERO_TEST_API_KEY }}
    steps:
      - name: Run E2E tests
        run: npm run test:e2e
        continue-on-error: true  # E2E可能不稳定
```

---

## ✅ 完成标志

项目完成所有测试计划后，应该：

1. **单元测试覆盖率 > 85%**
2. **集成测试覆盖所有关键路径**
3. **有可运行的E2E测试套件**
4. **自动化的性能监控**
5. **CI/CD流水线验证所有PR**

---

**执行顺序建议**：
1. 先从补全现有模块的测试开始
2. 搭建mock服务器用于集成测试  
3. 逐步添加CLI交互测试
4. 最后添加真实的E2E测试