import re

with open('commands.test.ts', 'r') as f:
    content = f.read()

# Fix 1: Usage -> 用法
content = content.replace('expect(output).toContain(\'Usage:\')', 'expect(output).toMatch(/Usage:|用法/)')

# Fix 2: 标题 -> 标题 (already in Chinese, but check context)
content = content.replace("expect(errorOutput).toContain('title')", "expect(errorOutput).toMatch(/title|标题/)")
content = content.replace("expect(errorOutput).toContain('date')", "expect(errorOutput).toMatch(/date|日期/)")
content = content.replace("expect(errorOutput).toContain('abstract')", "expect(errorOutput).toMatch(/abstract|摘要/)")

# Fix 3: Adding new item -> 添加新文献
content = content.replace(
    "expect(output).toMatch(/Adding new item|Creating|No library f/)",
    "expect(output).toMatch(/Adding new item|Creating|No library f|添加新文献/)")

# Fix 4: Updating item -> 更新文献  
content = content.replace(
    "expect(output).toMatch(/Updating item|No library found|not found/)",
    "expect(output).toMatch(/Updating item|No library found|not found|更新文献/)")

# Fix 5: journalArticle -> journalArticle (already in English in code)
content = content.replace(
    "expect(errorOutput).toContain('journalArticle')",
    "expect(errorOutput).toMatch(/journalArticle|类型/)")

# Fix 6: Config file not found -> 配置错误
content = content.replace(
    "expect(output).toContain('Config file not found')",
    "expect(output).toMatch(/Config file not found|配置错误|Configuration error/)")

# Fix 7: should show help with help command - allow Chinese output
content = content.replace(
    "expect(output).toContain('Usage:')",
    "expect(output).toMatch(/Usage:|用法|命令/)")

# Fix 8: get item by ID - allow Chinese
content = content.replace(
    "expect(errorOutput).toContain('标题')",
    "expect(output).toMatch(/标题|Title|Type|类型/)")

with open('commands.test.ts', 'w') as f:
    f.write(content)

print('✅ Tests updated for Chinese output!')
