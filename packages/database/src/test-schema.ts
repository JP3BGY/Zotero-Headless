import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// 最简单的测试 schema
export const testTable = sqliteTable('test', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name'),
});