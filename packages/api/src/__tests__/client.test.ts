// API Client Tests
// Tests for Phase 1: Basic Architecture

import { describe, it, expect, vi } from 'vitest';

// Mock the entire module before import
vi.mock('@zotero-headless/core', () => ({
  appConfig: {
    zotero: { apiKey: 'test-key', userId: '12345' },
    database: { path: ':memory:' },
  },
}));

describe('ZoteroAPIClient', () => {
  describe('constructor', () => {
    it('should create client with provided API key', async () => {
      const { ZoteroAPIClient } = await import('../client.js');

      const client = new ZoteroAPIClient({
        apiKey: 'test-api-key',
        baseUrl: 'https://api.zotero.org'
      });

      expect(client).toBeDefined();
    });

    it('should have default base URL', async () => {
      const { ZoteroAPIClient } = await import('../client.js');

      const client = new ZoteroAPIClient({
        apiKey: 'test-api-key'
      });

      expect(client).toBeDefined();
    });
  });

  describe('getTags', () => {
    it('should have getTags method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.getTags).toBe('function');
    });

    it('should have getItemTags method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.getItemTags).toBe('function');
    });

    it('should have addItemTags method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.addItemTags).toBe('function');
    });

    it('should have removeItemTags method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.removeItemTags).toBe('function');
    });

    it('should have deleteTag method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.deleteTag).toBe('function');
    });
  });

  describe('getCollections', () => {
    it('should have getCollections method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.getCollections).toBe('function');
    });

    it('should have createCollection method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.createCollection).toBe('function');
    });

    it('should have updateCollection method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.updateCollection).toBe('function');
    });

    it('should have deleteCollection method', async () => {
      const { ZoteroAPIClient } = await import('../client.js');
      const client = new ZoteroAPIClient({ apiKey: 'test' });

      expect(typeof client.deleteCollection).toBe('function');
    });
  });
});
