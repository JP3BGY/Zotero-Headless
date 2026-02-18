#!/usr/bin/env node
/**
 * WebDAV Client Integration Tests
 * Comprehensive test suite for WebDAV functionality
 */

import { WebDAVClient } from './packages/webdav-client/src/client.js';
import { AttachmentManager } from './packages/attachment-manager/src/manager.js';
import { getDatabase, initializeDatabase } from './packages/database/src/connection.js';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { attachments, webdavConfig } from './packages/database/src/schema.js';

// Test configuration
const TEST_DIR = path.join(process.cwd(), '.webdav-test-data');
const TEST_SERVER_URL = 'http://localhost:1900/zotero';
const TEST_CREDS = { username: 'test', password: 'test' };

// Test utilities
const tests: { name: string; fn: () => Promise<void> }[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('🧪 WebDAV Integration Tests\n');
  console.log('=' .repeat(50));
  
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error}`);
      failed++;
    }
  }
  
  console.log('=' .repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value: boolean, message?: string) {
  if (!value) {
    throw new Error(message || 'Expected true, got false');
  }
}

// Setup test environment
test('Setup: Initialize database', async () => {
  initializeDatabase();
  const db = getDatabase();
  assertTrue(db !== null, 'Database should be initialized');
});

// WebDAV Client Tests
test('WebDAV Client: Create instance', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  assertTrue(client !== null, 'Client should be created');
});

test('WebDAV Client: Test connection', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  const result = await client.testConnection();
  assertTrue(result.success, `Connection failed: ${result.error}`);
});

test('WebDAV Client: Create directory', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  const testDir = `/test-dir-${Date.now()}`;
  await client.createDirectory(testDir);
  
  const exists = await client.exists(testDir);
  assertTrue(exists, 'Directory should exist after creation');
  
  // Cleanup
  await client.deleteFile(testDir);
});

test('WebDAV Client: Upload and download file', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  // Create test file
  const testContent = Buffer.from('Hello, WebDAV!');
  const localPath = path.join(TEST_DIR, 'test-upload.txt');
  fs.writeFileSync(localPath, testContent);
  
  // Upload
  const remotePath = `/test-file-${Date.now()}.txt`;
  await client.uploadFile(localPath, remotePath);
  
  // Verify exists
  const exists = await client.exists(remotePath);
  assertTrue(exists, 'File should exist after upload');
  
  // Download
  const downloadPath = path.join(TEST_DIR, 'test-download.txt');
  await client.downloadFile(remotePath, downloadPath);
  
  // Verify content
  const downloaded = fs.readFileSync(downloadPath);
  assertTrue(
    testContent.equals(downloaded),
    'Downloaded content should match original'
  );
  
  // Cleanup
  await client.deleteFile(remotePath);
  fs.unlinkSync(localPath);
  fs.unlinkSync(downloadPath);
});

test('WebDAV Client: List files', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  // Create test directory with files
  const testDir = `/list-test-${Date.now()}`;
  await client.createDirectory(testDir);
  
  // Upload a file
  const testContent = Buffer.from('Test content');
  const localPath = path.join(TEST_DIR, 'list-test.txt');
  fs.writeFileSync(localPath, testContent);
  await client.uploadFile(localPath, `${testDir}/file1.txt`);
  fs.unlinkSync(localPath);
  
  // List files
  const files = await client.listFiles(testDir);
  assertTrue(files.length >= 1, 'Should list at least one file');
  assertTrue(
    files.some(f => f.name === 'file1.txt'),
    'Should include uploaded file'
  );
  
  // Cleanup
  await client.deleteFile(testDir);
});

test('WebDAV Client: Progress callback', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  // Create larger test file
  const testContent = Buffer.alloc(1024 * 100); // 100KB
  const localPath = path.join(TEST_DIR, 'progress-test.bin');
  fs.writeFileSync(localPath, testContent);
  
  let progressCalled = false;
  const remotePath = `/progress-test-${Date.now()}.bin`;
  
  await client.uploadFile(localPath, remotePath, (uploaded, total) => {
    progressCalled = true;
    assertTrue(uploaded > 0, 'Uploaded bytes should be > 0');
    assertTrue(total > 0, 'Total bytes should be > 0');
  });
  
  assertTrue(progressCalled, 'Progress callback should be called');
  
  // Cleanup
  await client.deleteFile(remotePath);
  fs.unlinkSync(localPath);
});

test('WebDAV Client: Delete file', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  // Create and upload file
  const testContent = Buffer.from('To be deleted');
  const localPath = path.join(TEST_DIR, 'delete-test.txt');
  fs.writeFileSync(localPath, testContent);
  
  const remotePath = `/delete-test-${Date.now()}.txt`;
  await client.uploadFile(localPath, remotePath);
  fs.unlinkSync(localPath);
  
  // Verify exists
  let exists = await client.exists(remotePath);
  assertTrue(exists, 'File should exist before deletion');
  
  // Delete
  await client.deleteFile(remotePath);
  
  // Verify deleted
  exists = await client.exists(remotePath);
  assertTrue(!exists, 'File should not exist after deletion');
});

// Attachment Manager Tests
test('Attachment Manager: Initialize', async () => {
  const db = getDatabase();
  const manager = new AttachmentManager(db);
  assertTrue(manager !== null, 'Manager should be initialized');
});

test('Attachment Manager: Configure WebDAV', async () => {
  const db = getDatabase();
  const manager = new AttachmentManager(db);
  
  const result = await manager.configureWebDAV({
    url: TEST_SERVER_URL,
    username: TEST_CREDS.username,
    password: TEST_CREDS.password,
    basePath: '/zotero'
  });
  
  assertTrue(result.success, `Configuration failed: ${result.error}`);
  
  // Verify config in database
  const config = await db.select().from(webdavConfig).get();
  assertTrue(config !== null, 'Config should be stored in database');
  assertEqual(config?.url, TEST_SERVER_URL);
});

test('Attachment Manager: Get WebDAV status', async () => {
  const db = getDatabase();
  const manager = new AttachmentManager(db);
  
  const status = await manager.getWebDAVStatus();
  assertTrue(status.configured, 'WebDAV should be configured');
  assertTrue(status.enabled, 'WebDAV should be enabled');
  assertTrue(status.client !== null, 'Client should be initialized');
});

// Integration Tests
test('Integration: Full sync workflow', async () => {
  const db = getDatabase();
  const manager = new AttachmentManager(db);
  
  // Ensure WebDAV is configured
  const status = await manager.getWebDAVStatus();
  if (!status.configured) {
    await manager.configureWebDAV({
      url: TEST_SERVER_URL,
      username: TEST_CREDS.username,
      password: TEST_CREDS.password,
      basePath: '/zotero'
    });
  }
  
  // Create test attachment record
  const testItemKey = 'TEST1234';
  await db.insert(attachments).values({
    key: testItemKey,
    parentItemKey: 'PARENT5678',
    libraryId: 1,
    filename: 'test-attachment.pdf',
    contentType: 'application/pdf',
    path: '/tmp/test-attachment.pdf',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    rawJson: '{}'
  }).onConflictDoNothing();
  
  // Create dummy file
  const testFile = '/tmp/test-attachment.pdf';
  fs.writeFileSync(testFile, Buffer.from('PDF content'));
  
  // Sync attachment
  const result = await manager.syncAttachments({
    itemKey: testItemKey,
    onProgress: (current, total, filename) => {
      console.log(`   Progress: ${current}/${total} - ${filename}`);
    }
  });
  
  assertTrue(result.success, `Sync failed: ${result.error}`);
  assertEqual(result.synced, 1, 'Should sync 1 attachment');
  
  // Cleanup
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
  await db.delete(attachments).where(eq(attachments.key, testItemKey));
});

// Error Handling Tests
test('Error Handling: Invalid credentials', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    username: 'wrong',
    password: 'wrong'
  });
  
  const result = await client.testConnection();
  assertTrue(!result.success, 'Should fail with wrong credentials');
  assertTrue(result.error?.includes('401') || result.error?.includes('Unauthorized'), 
    'Should return 401 error');
});

test('Error Handling: Non-existent file', async () => {
  const client = new WebDAVClient({
    url: TEST_SERVER_URL,
    ...TEST_CREDS
  });
  
  const exists = await client.exists('/non-existent-file-' + Date.now() + '.txt');
  assertTrue(!exists, 'Should return false for non-existent file');
});

// Run all tests
runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
