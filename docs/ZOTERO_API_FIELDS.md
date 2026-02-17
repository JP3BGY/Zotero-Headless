# Zotero API 字段限制

本文档记录 Zotero API 对上传数据字段的严格限制。

## 问题

Zotero API 在创建/更新项目时会拒绝包含未知字段的请求，返回 400 错误：
```
Invalid property 'xxx'
```

## 允许的字段

根据 Zotero API 文档，创建项目时只允许以下字段：

### 核心字段
- `itemType` (必需) - 项目类型，如 `journalArticle`, `book`, `conferencePaper`
- `title` (必需) - 标题
- `creators` - 作者数组
- `date` - 发布日期（注意：不是 `publicationDate`）
- `url` - URL
- `DOI` - DOI 标识符
- `abstractNote` - 摘要（注意：不是 `abstract`）

### 其他可选字段
- `accessDate` - 访问日期
- `libraryCatalog` - 图书馆目录
- `callNumber` - 索书号
- `rights` - 版权信息
- `extra` - 额外信息
- `tags` - 标签数组
- `collections` - 所属集合

## 常见错误

### ❌ 错误：使用 publicationDate
```javascript
// 错误
data.publicationDate = '2021-07-15';

// 正确
data.date = '2021-07-15';
```

### ❌ 错误：使用 abstract
```javascript
// 错误
data.abstract = '摘要内容';

// 正确
data.abstractNote = '摘要内容';
```

### ❌ 错误：包含自定义字段
```javascript
// 错误 - API 会拒绝
{
  itemType: 'journalArticle',
  title: 'Test',
  journal: 'Nature',        // ❌ 不允许
  volume: '10',             // ❌ 不允许
  issue: '1',               // ❌ 不允许
  pages: '1-10',            // ❌ 不允许
  publisher: 'Springer',    // ❌ 不允许
  isbn: '1234567890',       // ❌ 不允许
  issn: '1234-5678'         // ❌ 不允许
}

// 正确
{
  itemType: 'journalArticle',
  title: 'Test',
  date: '2021-07-15',
  creators: [
    { creatorType: 'author', firstName: 'John', lastName: 'Doe' }
  ]
}
```

### ❌ 错误：creators 是字符串而非数组
```javascript
// 错误
creators: JSON.stringify([{firstName: 'John', lastName: 'Doe'}])

// 正确
creators: [{firstName: 'John', lastName: 'Doe'}]
```

## 解决方案

在 `uploadChanges` 方法中，我们进行以下数据转换：

1. **字段名转换**：`publicationDate` → `date`
2. **字段过滤**：删除所有不在白名单中的字段
3. **数据类型转换**：将字符串类型的 creators 解析为数组

## 参考

- [Zotero API Documentation](https://www.zotero.org/support/dev/web_api/v3/start)
- [Item Types and Fields](https://www.zotero.org/support/dev/web_api/v3/types_and_fields)
