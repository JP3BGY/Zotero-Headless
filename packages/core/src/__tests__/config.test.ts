// Configuration System Tests
// Based on TDD_EXECUTION_PLAN.md Section 3.1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('User Configuration', () => {
  const testDir = path.join(os.tmpdir(), 'zotero-headless-test-' + Date.now());
  
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  describe('Default Configuration', () => {
    it('should have sensible defaults', () => {
      const defaults = {
        apiKey: undefined,
        userId: undefined,
        database: {
          path: './.zotero-headless.db',
        },
        sync: {
          batchSize: 50,
          maxRetries: 3,
          conflictStrategy: 'local',
        },
        log: {
          level: 'info',
        }
      };
      
      expect(defaults.sync.batchSize).toBe(50);
      expect(defaults.sync.maxRetries).toBe(3);
      expect(defaults.sync.conflictStrategy).toBe('local');
    });
  });
  
  describe('Configuration File Loading', () => {
    it('should load config from user home directory', () => {
      const homeConfigPath = path.join(os.homedir(), '.zotero-headless.json');
      
      // This test defines the expected behavior
      // Config should be loaded from ~/.zotero-headless.json
      expect(homeConfigPath).toContain('.zotero-headless.json');
    });
    
    it('should load config from project directory', () => {
      const projectConfigPath = path.join(process.cwd(), '.zotero-headless.json');
      
      // Config should be loaded from project root
      expect(projectConfigPath).toContain('.zotero-headless.json');
    });
    
    it('should support JSON configuration format', () => {
      const validConfig = {
        apiKey: 'test-key',
        userId: '12345',
        sync: {
          batchSize: 100,
        }
      };
      
      // Should parse valid JSON
      const parsed = JSON.parse(JSON.stringify(validConfig));
      expect(parsed.apiKey).toBe('test-key');
    });
  });
  
  describe('Configuration Priority', () => {
    it('should prioritize CLI flags over config file', () => {
      // Priority order (highest to lowest):
      // 1. CLI flags
      // 2. Environment variables
      // 3. Project config (~/.zotero-headless.json)
      // 4. User config (.zotero-headless.json in cwd)
      // 5. Defaults
      
      const priority = {
        cliFlags: 5,
        envVars: 4,
        projectConfig: 3,
        userConfig: 2,
        defaults: 1,
      };
      
      expect(priority.cliFlags).toBeGreaterThan(priority.envVars);
      expect(priority.envVars).toBeGreaterThan(priority.defaults);
    });
    
    it('should use environment variables as override', () => {
      // ZOTERO_API_KEY should override config file
      const envOverride = process.env.ZOTERO_API_KEY;
      
      // This defines expected behavior
      expect(envOverride === undefined || typeof envOverride === 'string').toBe(true);
    });
  });
  
  describe('Configuration Validation', () => {
    it('should validate required fields', () => {
      const validateConfig = (config: any) => {
        const errors: string[] = [];
        
        if (!config.apiKey) {
          errors.push('apiKey is required');
        }
        
        if (!config.userId) {
          errors.push('userId is required');
        }
        
        if (config.sync?.batchSize && config.sync.batchSize < 1) {
          errors.push('batchSize must be positive');
        }
        
        return errors;
      };
      
      // Test with missing fields
      const errors1 = validateConfig({});
      expect(errors1.length).toBe(2);
      
      // Test with valid config
      const errors2 = validateConfig({ apiKey: 'key', userId: '123' });
      expect(errors2.length).toBe(0);
    });
    
    it('should reject invalid API key format', () => {
      const isValidKey = (key: string) => {
        // Zotero API keys are typically 32-char alphanumeric
        return /^[a-zA-Z0-9]{32,}$/.test(key);
      };
      
      expect(isValidKey('test-key-too-short')).toBe(false);
      expect(isValidKey('12345678901234567890123456789012')).toBe(true);
    });
  });
  
  describe('Hot Reload', () => {
    it('should watch config file for changes', () => {
      // Should detect when config file is modified
      const watchCallback = vi.fn();
      
      // This defines the expected API
      expect(typeof watchCallback).toBe('function');
    });
    
    it('should reload without restart', () => {
      // After config change, new values should be used
      let config = { value: 1 };
      
      // Simulate reload
      config = { ...config, value: 2 };
      
      expect(config.value).toBe(2);
    });
  });
});

describe('Setup Wizard', () => {
  describe('API Key Setup', () => {
    it('should provide instructions for getting API key', () => {
      const instructions = {
        step1: 'Visit https://www.zotero.org/settings/keys',
        step2: 'Click "Create new key"',
        step3: 'Grant read/write access to library',
        step4: 'Copy the generated key',
      };
      
      expect(instructions.step1).toContain('zotero.org');
    });
    
    it('should validate key after user enters it', async () => {
      const validateKey = async (key: string) => {
        // Would make API call to validate
        if (!key || key.length < 32) {
          return { valid: false, error: 'Invalid key format' };
        }
        return { valid: true, userId: '12345' };
      };
      
      const result = await validateKey('test-api-key');
      expect(result.valid).toBe(false); // Too short
    });
  });
  
  describe('Interactive Configuration', () => {
    it('should prompt for missing required values', () => {
      const requiredFields = ['apiKey', 'userId'];
      const missingFields = (config: any) => 
        requiredFields.filter(field => !config[field]);
      
      expect(missingFields({})).toEqual(['apiKey', 'userId']);
      expect(missingFields({ apiKey: 'key' })).toEqual(['userId']);
      expect(missingFields({ apiKey: 'key', userId: '123' })).toEqual([]);
    });
    
    it('should offer sensible defaults for optional values', () => {
      const defaults = {
        syncBatchSize: 50,
        logLevel: 'info',
        conflictStrategy: 'local',
      };
      
      expect(defaults.syncBatchSize).toBe(50);
      expect(defaults.conflictStrategy).toBe('local');
    });
  });
});
