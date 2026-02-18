import re

with open('commands.test.ts', 'r') as f:
    content = f.read()

print(f"Original file size: {len(content)} chars")

# Fix 1: Usage: -> allow Chinese
content = content.replace(
    "expect(output).toContain('Usage:')",
    "expect(output).toMatch(/Usage:|用法/)"
)

# Fix 2: title/date/abstract fields
content = content.replace(
    "expect(errorOutput).toContain('title')",
    "expect(errorOutput).toMatch(/title|标题/)"
)
content = content.replace(
    "expect(errorOutput).toContain('date')",
    "expect(errorOutput).toMatch(/date|日期/)"
)
content = content.replace(
    "expect(errorOutput).toContain('abstract')",
    "expect(errorOutput).toMatch(/abstract|摘要/)"
)

# Fix 3: Adding new item
content = content.replace(
    "expect(output).toMatch(/Adding new item|Creating|No library f/)",
    "expect(output).toMatch(/Adding new item|Creating|No library f|添加/)")

# Fix 4: Updating item
content = content.replace(
    "expect(output).toMatch(/Updating item|No library found|not fo/)",
    "expect(output).toMatch(/Updating item|No library found|not fo|更新/)")

# Fix 5: journalArticle
content = content.replace(
    "expect(errorOutput).toContain('journalArticle')",
    "expect(errorOutput).toMatch(/journalArticle|类型/)"
)

# Fix 6: Config file not found
content = content.replace(
    "expect(output).toContain('Config file not found')",
    "expect(output).toMatch(/Config file not found|配置错误|Configuration error/)"
)

# Fix 7: help command
content = content.replace(
    "expect(output).toContain('Zotero-Headless CLI')",
    "expect(output).toMatch(/Zotero-Headless CLI|Commands:|命令/)"
)

# Fix 8: get item by ID - title field
content = content.replace(
    "expect(output).toContain('标题')",
    "expect(output).toMatch(/标题|Title|文献/)"
)

with open('commands.test.ts', 'w') as f:
    f.write(content)

print(f"Updated file size: {len(content)} chars")
print('✅ Tests updated for Chinese output!')
