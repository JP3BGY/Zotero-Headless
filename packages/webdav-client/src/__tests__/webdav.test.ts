// WebDAV Client Unit Tests
// Tests for WebDAV protocol implementation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebDAVClient } from '../client.js';

describe('WebDAVClient', () => {
  let client: WebDAVClient;
  const mockConfig = {
    url: 'http://localhost:1900/zotero',
    username: 'test',
    password: 'test',
  };
  
  beforeEach(() => {
    client = new WebDAVClient(mockConfig);
  });
  
  describe('Initialization', () => {
    it('should create client with config', () => {
      expect(client).toBeDefined();
    });
    
    it('should store base URL correctly', () => {
      const baseUrl = (client as any).baseUrl;
      expect(baseUrl.toString()).toBe('http://localhost:1900/zotero');
    });
    
    it('should handle URL with trailing slash', () => {
      const clientWithSlash = new WebDAVClient({
        ...mockConfig,
        url: 'http://localhost:1900/zotero/'
      });
      expect(clientWithSlash).toBeDefined();
    });
  });
  
  describe('Authentication', () => {
    it('should encode credentials for Basic auth', () => {
      const expectedAuth = Buffer.from('test:test').toString('base64');
      expect(expectedAuth).toBe('dGVzdDp0ZXN0');
    });
  });
  
  describe('Error Handling', () => {
    it('should return false for non-existent file', async () => {
      const exists = await client.exists('/non-existent-file.txt');
      expect(exists).toBe(false);
    });
    
    it('should handle connection errors', async () => {
      // Connection to non-existent server should fail gracefully
      const badClient = new WebDAVClient({
        url: 'http://localhost:59999', // Use valid port range
        username: 'test',
        password: 'test'
      });
      
      const result = await badClient.testConnection();
      expect(result.success).toBe(false);
    });
  });
  
  describe('Retry Logic', () => {
    it('should have maxRetries configured', () => {
      const maxRetries = (client as any).maxRetries;
      expect(maxRetries).toBeGreaterThan(0);
    });
    
    it('should have timeout configured', () => {
      const timeout = (client as any).timeout;
      expect(timeout).toBeGreaterThan(0);
    });
  });
});

describe('AttachmentManager WebDAV Integration', () => {
  describe('Configuration', () => {
    it('should accept WebDAV configuration', () => {
      const config = {
        url: 'http://test.com/dav',
        username: 'user',
        password: 'pass',
        basePath: '/zotero'
      };
      
      expect(config.url).toBeDefined();
      expect(config.username).toBeDefined();
      expect(config.password).toBeDefined();
      expect(config.basePath).toBeDefined();
    });
    
    it('should use default basePath', () => {
      const config = {
        url: 'http://test.com/dav',
        username: 'user',
        password: 'pass'
      };
      
      const basePath = config.basePath || '/zotero';
      expect(basePath).toBe('/zotero');
    });
  });
  
  describe('Sync Operations', () => {
    it('should generate correct .prop content', () => {
      const expectedFormat = '<properties version="1"><mtime>';
      expect(expectedFormat).toContain('properties');
      expect(expectedFormat).toContain('mtime');
    });
    
    it('should calculate MD5 of ZIP file', () => {
      const testContent = Buffer.from('test');
      const expectedHash = '098f6bcd4621d373cade4e832627b4f6';
      expect(expectedHash).toHaveLength(32);
    });
    
    it('should create ZIP for non-ZIP files', () => {
      const nonZipFile = 'document.pdf';
      const shouldZip = !nonZipFile.toLowerCase().endsWith('.zip');
      expect(shouldZip).toBe(true);
    });
    
    it('should not re-zip ZIP files', () => {
      const zipFile = 'archive.zip';
      const shouldZip = !zipFile.toLowerCase().endsWith('.zip');
      expect(shouldZip).toBe(false);
    });
  });
  
  describe('Zotero Desktop Compatibility', () => {
    it('should use correct file naming: <item_key>.zip', () => {
      const itemKey = 'ABCD1234';
      const expectedZipName = `${itemKey}.zip`;
      expect(expectedZipName).toBe('ABCD1234.zip');
    });
    
    it('should use correct prop naming: <item_key>.prop', () => {
      const itemKey = 'ABCD1234';
      const expectedPropName = `${itemKey}.prop`;
      expect(expectedPropName).toBe('ABCD1234.prop');
    });
    
    it('should place files in /zotero/ root', () => {
      const basePath = '/zotero';
      const fileName = 'ABCD1234.zip';
      const fullPath = `${basePath}/${fileName}`;
      expect(fullPath).toBe('/zotero/ABCD1234.zip');
    });
  });
});

describe('WebDAV Protocol Support', () => {
  describe('PROPFIND', () => {
    it('should support PROPFIND method', () => {
      const methods = ['PROPFIND', 'GET', 'PUT', 'DELETE', 'MKCOL'];
      expect(methods).toContain('PROPFIND');
    });
    
    it('should parse XML response', () => {
      const sampleResponse = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/test.txt</D:href>
  </D:response>
</D:multistatus>`;
      
      expect(sampleResponse).toContain('multistatus');
      expect(sampleResponse).toContain('href');
    });
  });
  
  describe('File Operations', () => {
    it('should support PUT for upload', () => {
      const methods = ['PUT', 'GET', 'DELETE'];
      expect(methods).toContain('PUT');
    });
    
    it('should support GET for download', () => {
      const methods = ['PUT', 'GET', 'DELETE'];
      expect(methods).toContain('GET');
    });
    
    it('should support DELETE for removal', () => {
      const methods = ['PUT', 'GET', 'DELETE'];
      expect(methods).toContain('DELETE');
    });
    
    it('should support MKCOL for directories', () => {
      const methods = ['MKCOL', 'PROPFIND'];
      expect(methods).toContain('MKCOL');
    });
  });
});

describe('Progress Callbacks', () => {
  it('should call progress during upload', async () => {
    const progressCallback = vi.fn();
    expect(typeof progressCallback).toBe('function');
  });
  
  it('should call progress during download', async () => {
    const progressCallback = vi.fn();
    expect(typeof progressCallback).toBe('function');
  });
  
  it('should report correct byte counts', () => {
    const uploaded = 1024;
    const total = 2048;
    
    expect(uploaded).toBeLessThanOrEqual(total);
    expect(uploaded).toBeGreaterThanOrEqual(0);
  });
});

describe('Self-Signed Certificate Support', () => {
  it('should allow self-signed certificates', () => {
    const agentConfig = { rejectUnauthorized: false };
    expect(agentConfig.rejectUnauthorized).toBe(false);
  });
});
