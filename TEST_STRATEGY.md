# Zotero-Headless 测试驱动开发策略

## 第一阶段：立即行动 (Sprint 1)

### 1.1 单元测试扩展（当前最薄弱环节）

#### API 层（立即补充）
```typescript
// 1. 重试机制测试
test('exponential backoff with retry limit', async () => {
  // 测试指数退避算法
});

// 2. 鉴权测试
test('API key validation', async () => {
  // 有效key、无效key、过期key
});

// 3. 错误处理
test('handle 429 rate limit', async () => {
  // 模拟429响应，验证等待机制
});

// 4. 请求构建器
test('build proper request headers', () => {
  // Zotero版本、API key、如果修改版本
});
```

#### Database 层（从概念测试→真实测试）
```typescript
// 1. 真实数据库连接测试 (本地)
test('real SQLite operations', async () => {
  // 需要安装 better-sqlite3
});

// 2. 事务测试
test('transaction rollback on error', async () => {
  // 保证数据一致性
});

// 3. 索引性能测试
test('query performance with indexes', async () => {
  // 测试大数据的查询性能
});
```

#### CLI 层（完全缺失）
```typescript
// 1. 命令测试
test('zotero sync --help', async () => {
  // 验证帮助信息
});

// 2. 参数解析测试
test('parse JSON config file', async () => {
  // .zotero-headless.json
});

// 3. 交互式命令测试
test('interactive item selection', async () => {
  // 使用 inquirer.js 的模拟测试
});
```

### 1.2 配置驱动的测试矩阵

创建 `test-config.json`：
```json
{
  "testEnvironments": [
    {
      "name": "sqlite-memory",
      "database": ":memory:",
      "cleanup": "auto"
    },
    {
      "name": "sqlite-file",
      "database": "test-db.sqlite",
      "cleanup": "file"
    }
  ],
  "zoteroScenarios": [
    {
      "name": "small-library",
      "items": 10,
      "collections": 3
    },
    {
      "name": "medium-library", 
      "items": 100,
      "collections": 10
    }
  ]
}
```

---

## 第二阶段：集成测试 (Sprint 2)

### 2.1 API 集成测试
```typescript
// Mock 服务器 (MSW 或 nock)
const server = setupServer(
  rest.get('https://api.zotero.org/users/:userId/items', ...),
  rest.post('https://api.zotero.org/users/:userId/items', ...),
  rest.put('https://api.zotero.org/users/:userId/items/:key', ...),
  rest.get('https://api.zotero.org/users/:userId/collections', ...)
);

// 完整同步流程测试
test('full sync cycle with mock API', async () => {
  // 1. 初始化数据库
  // 2. 模拟远程空状态
  // 3. 添加本地项目
  // 4. 同步到远程
  // 5. 修改远程
  // 6. 再次同步 - 应该合并
});
```

### 2.2 文件系统集成
```typescript
// 配置文件测试
test('config file precedence', async () => {
  // .env > config.json > CLI参数 > 默认值
});

// SQLite数据库文件测试
test('database file creation and migration', async () => {
  // 新版本schema迁移测试
});
```

---

## 第三阶段：端到端和特性测试 (Sprint 3)

### 3.1 真实场景测试
```typescript
// 使用真实Zotero测试账号（隔离的）
describe('E2E with real Zotero account', () => {
  beforeAll(() => {
    if (!process.env.ZOTERO_TEST_API_KEY) {
      test.skip('需要设置测试环境变量', () => {});
    }
  });
  
  test('sync with real small library', async () => {
    // 1. 创建测试库
    // 2. 执行完整同步
    // 3. 验证数据完整性
    // 4. 清理测试数据
  });
});
```

### 3.2 性能基准测试
```typescript
// 性能回归测试
bench('sync 100 items', async () => {
  await zotero.sync();
});

// 内存使用监控
test('memory usage after large sync', async () => {
  const before = process.memoryUsage();
  await zotero.sync({ fullSync: true });
  const after = process.memoryUsage();
  
  expect(after.heapUsed - before.heapUsed).toBeLessThan(100 * 1024 * 1024); // 100MB
});
```

---

## 📊 测试执行策略

### 按功能模块划分

#### Module: `sync-engine`
- ✅ 基本冲突解决 ✅
- 🔄 重试机制测试 ⏳
- 🔄 并发控制 ❌
- 🔄 大库优化 ❌

#### Module: `api`
- ✅ 客户端构造 ✅  
- 🔄 请求重试 ❌
- 🔄 错误处理 ❌
- 🔄 类型转换 ❌

#### Module: `database`
- ⚠️ 概念验证 ✅
- 🔄 真实SQLite测试 ❌
- 🔄 迁移测试 ❌
- 🔄 性能测试 ❌

#### Module: `cli`
- ❌ 命令行界面 ❌
- ❌ 交互式命令 ❌
- ❌ 配置文件 ❌
- ❌ 进度显示 ❌

---

## 🚀 测试驱动工作流 (Coding Agent可用)

### 每次迭代的流程：
```yaml
Cycle:
  Trigger: "有新功能需要实现"
  Steps:
    1. 编写/更新测试用例
        - 描述期望行为
        - 定义接口契约
        - 设置边界条件
    
    2. 运行测试（应该失败）
        - 验证测试确实能检测错误
        - 查看错误信息是否清晰
    
    3. 实现最小可行代码
        - 只修改必要的文件
        - 让测试通过
        - 保持代码简洁
    
    4. 重构和优化
        - 改进代码结构
        - 确保测试仍然通过
        - 提交到git
    
    5. 运行完整测试套件
        - 确保没有回归
        - 更新覆盖率报告
```

### 自动化工具链：
```bash
# 开发和调试阶段
npm run test:watch              # 监听模式

# CI/CD 流水线
npm run test:ci                 # 完整套件 + 覆盖率
npm run test:e2e                # 端到端测试
npm run bench                   # 性能基准

# 质量门禁
npx danger                      # PR 检查
npx lcov-summary coverage/lcov.info   # 覆盖率要求
```

---

## 📈 进度追踪指标

| 指标 | 当前 | 目标 | 状态 |
|------|------|------|------|
| 单元测试覆盖率 | ~60% | 85% | ⚠️ |
| 集成测试覆盖率 | 0% | 70% | ❌ |
| 端到端测试 | 0个 | 5个 | ❌ |
| 性能基准 | 0个 | 3个 | ❌ |
| CI/CD 集成 | 否 | 是 | ❌ |
| 回归测试集 | 24个 | 100+ | ⚠️ |

---

## 🎯 下一步优先事项

### P0 (本周)
1. **真实数据库测试** - 实现带依赖的测试环境
2. **CI 集成** - GitHub Actions 自动运行测试
3. **测试覆盖率** - 设置85%覆盖率要求

### P1 (下周)
1. **集成测试框架** - 使用Mock Service Worker
2. **CLI基础测试** - 命令行界面测试
3. **错误处理测试** - 所有可能的失败路径

### P2 (第二周)
1. **端到端测试** - 真实Zotero账号测试
2. **性能基准** - 监控性能回归
3. **安全测试** - API key安全、输入验证

---

**关键洞见**：Zotero-Headless 目前只有单元测试的皮毛。要支持持续迭代，需要建立多层测试架构，特别是集成和端到端测试，以验证真实的数据同步流程。