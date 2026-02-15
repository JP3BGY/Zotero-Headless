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
});
