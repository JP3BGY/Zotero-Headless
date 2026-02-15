// Database Schema Tests
// Tests for Phase 1: Basic Architecture

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';

describe('Database Schema', () => {
  let db: ReturnType<typeof drizzle>;
  
  beforeEach(() => {
    // Use in-memory database for testing
    const sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema });
  });
  
  afterEach(() => {
    // @ts-ignore
    db.$client.close();
  });
  
  describe('Libraries Table', () => {
    it('should insert a library', async () => {
      const result = await db.insert(schema.libraries)
        .values({
          zoteroId: '12345',
          type: 'user',
          name: 'Test Library',
          version: 0,
        })
        .returning({ id: schema.libraries.id })
        .get();
      
      expect(result.id).toBeGreaterThan(0);
    });
    
    it('should enforce unique constraint on zoteroId + type', async () => {
      // Insert first library
      await db.insert(schema.libraries)
        .values({
          zoteroId: '12345',
          type: 'user',
          name: 'First Library',
        })
        .run();
      
      // Try to insert duplicate - should fail
      await expect(
        db.insert(schema.libraries)
          .values({
            zoteroId: '12345',
            type: 'user',
            name: 'Second Library',
          })
          .run()
      ).rejects.toThrow();
    });
  });
  
  describe('Items Table', () => {
    let libraryId: number;
    
    beforeEach(async () => {
      const result = await db.insert(schema.libraries)
        .values({
          zoteroId: '12345',
          type: 'user',
          name: 'Test Library',
        })
        .returning({ id: schema.libraries.id })
        .get();
      libraryId = result.id;
    });
    
    it('should insert an item', async () => {
      const now = new Date();
      const result = await db.insert(schema.items)
        .values({
          key: 'ABCD1234',
          libraryId,
          version: 1,
          itemType: 'journalArticle',
          title: 'Test Article',
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .returning({ key: schema.items.key })
        .get();
      
      expect(result.key).toBe('ABCD1234');
    });
    
    it('should upsert item (on conflict update)', async () => {
      const now = new Date();
      
      // Insert first time
      await db.insert(schema.items)
        .values({
          key: 'ABCD1234',
          libraryId,
          version: 1,
          itemType: 'journalArticle',
          title: 'Original Title',
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .run();
      
      // Upsert with new version
      await db.insert(schema.items)
        .onConflictDoUpdate({
          target: [schema.items.key, schema.items.libraryId],
          set: {
            title: 'Updated Title',
            version: 2,
            updatedAt: new Date(),
          },
        })
        .values({
          key: 'ABCD1234',
          libraryId,
          version: 2,
          itemType: 'journalArticle',
          title: 'Updated Title',
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .run();
      
      // Verify update
      const item = await db.select()
        .from(schema.items)
        .where(schema.items.key.equals('ABCD1234'))
        .get();
      
      expect(item?.title).toBe('Updated Title');
      expect(item?.version).toBe(2);
    });
    
    it('should support soft delete', async () => {
      const now = new Date();
      
      await db.insert(schema.items)
        .values({
          key: 'ABCD1234',
          libraryId,
          version: 1,
          itemType: 'journalArticle',
          title: 'Test',
          deleted: false,
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .run();
      
      // Soft delete
      await db.update(schema.items)
        .set({ deleted: true, updatedAt: new Date() })
        .where(schema.items.key.equals('ABCD1234'))
        .run();
      
      // Verify soft delete
      const item = await db.select()
        .from(schema.items)
        .where(schema.items.key.equals('ABCD1234'))
        .get();
      
      expect(item?.deleted).toBe(true);
    });
  });
  
  describe('Collections Table', () => {
    let libraryId: number;
    
    beforeEach(async () => {
      const result = await db.insert(schema.libraries)
        .values({
          zoteroId: '12345',
          type: 'user',
        })
        .returning({ id: schema.libraries.id })
        .get();
      libraryId = result.id;
    });
    
    it('should insert collection with parent', async () => {
      const now = new Date();
      
      // Insert parent collection
      const parent = await db.insert(schema.collections)
        .values({
          key: 'PARENT01',
          libraryId,
          name: 'Parent Collection',
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .returning({ key: schema.collections.key })
        .get();
      
      // Insert child collection
      const child = await db.insert(schema.collections)
        .values({
          key: 'CHILD001',
          libraryId,
          name: 'Child Collection',
          parentKey: parent.key,
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .returning({ key: schema.collections.key, parentKey: schema.collections.parentKey })
        .get();
      
      expect(child.parentKey).toBe('PARENT01');
    });
  });
  
  describe('Item Tags Table', () => {
    let libraryId: number;
    
    beforeEach(async () => {
      const result = await db.insert(schema.libraries)
        .values({
          zoteroId: '12345',
          type: 'user',
        })
        .returning({ id: schema.libraries.id })
        .get();
      libraryId = result.id;
    });
    
    it('should insert item tag', async () => {
      const now = new Date();
      const nowNum = now.getTime();
      
      await db.insert(schema.items)
        .values({
          key: 'ABCD1234',
          libraryId,
          version: 1,
          itemType: 'journalArticle',
          title: 'Test',
          createdAt: now,
          updatedAt: now,
          rawJson: '{}',
        })
        .run();
      
      await db.insert(schema.itemTags)
        .values({
          itemKey: 'ABCD1234',
          libraryId,
          tag: 'machine-learning',
          tagType: 0,
          createdAt: now,
        })
        .run();
      
      const tags = await db.select()
        .from(schema.itemTags)
        .where(schema.itemTags.itemKey.equals('ABCD1234'))
        .all();
      
      expect(tags.length).toBe(1);
      expect(tags[0].tag).toBe('machine-learning');
    });
  });
  
  describe('Sync Logs Table', () => {
    let libraryId: number;
    
    beforeEach(async () => {
      const result = await db.insert(schema.libraries)
        .values({
          zoteroId: '12345',
          type: 'user',
        })
        .returning({ id: schema.libraries.id })
        .get();
      libraryId = result.id;
    });
    
    it('should insert sync log', async () => {
      const now = new Date();
      
      await db.insert(schema.syncLogs)
        .values({
          libraryId,
          startedAt: now,
          completedAt: now,
          status: 'success',
          remoteVersion: 100,
          localVersion: 50,
          itemsUpdated: 10,
          itemsDeleted: 2,
        })
        .run();
      
      const logs = await db.select()
        .from(schema.syncLogs)
        .where(schema.syncLogs.libraryId.equals(libraryId))
        .all();
      
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe('success');
      expect(logs[0].itemsUpdated).toBe(10);
    });
  });
});
