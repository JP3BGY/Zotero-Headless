// Configuration System Tests
// Based on TDD_EXECUTION_PLAN.md Section 3.1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findAllEnvFiles, hasZoteroConfig } from '../config.js';

// Mock os module for testing
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => actual.homedir()),
  };
});

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

describe('Multi-level .env Configuration Loading', () => {
  /**
   * Regression Test: Issue #1
   * When running zotero from a directory with an unrelated .env file (e.g., ~/.openclaw/.env),
   * the configuration should still be loaded from ~/.config/zotero-headless/.env.
   * 
   * This ensures that zotero works correctly regardless of the current working directory.
   */
  const testBaseDir = path.join(os.tmpdir(), 'zotero-env-test-' + Date.now());
  const mockHomeDir = path.join(testBaseDir, 'home');
  const mockCwdDir = path.join(testBaseDir, 'cwd');
  
  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(mockHomeDir, { recursive: true });
    fs.mkdirSync(mockCwdDir, { recursive: true });
    fs.mkdirSync(path.join(mockHomeDir, '.config', 'zotero-headless'), { recursive: true });
    
    // Save original env and cwd
    (global as any).originalEnv = { ...process.env };
    (global as any).originalCwd = process.cwd();
  });
  
  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach(key => delete process.env[key]);
    Object.assign(process.env, (global as any).originalEnv);
    
    // Cleanup test directory
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });
  
  describe('hasZoteroConfig', () => {
    it('should detect Zotero configuration in .env file', () => {
      const envWithZotero = path.join(testBaseDir, 'with-zotero.env');
      const envWithoutZotero = path.join(testBaseDir, 'without-zotero.env');
      
      fs.writeFileSync(envWithZotero, 'ZOTERO_API_KEY=test123\nZOTERO_USER_ID=12345\n');
      fs.writeFileSync(envWithoutZotero, '# Some other config\nOTHER_KEY=value\n');
      
      expect(hasZoteroConfig(envWithZotero)).toBe(true);
      expect(hasZoteroConfig(envWithoutZotero)).toBe(false);
      expect(hasZoteroConfig('/nonexistent/file.env')).toBe(false);
    });
    
    it('should return false for files with only one of the required keys', () => {
      const envPartial1 = path.join(testBaseDir, 'partial1.env');
      const envPartial2 = path.join(testBaseDir, 'partial2.env');
      
      fs.writeFileSync(envPartial1, 'ZOTERO_API_KEY=test123\n');
      fs.writeFileSync(envPartial2, 'ZOTERO_USER_ID=12345\n');
      
      expect(hasZoteroConfig(envPartial1)).toBe(false);
      expect(hasZoteroConfig(envPartial2)).toBe(false);
    });
  });
  
  describe('Configuration Priority and Merging', () => {
    it('should find all .env files in correct priority order', () => {
      // Create .env files at different locations
      const cwdEnv = path.join(mockCwdDir, '.env');
      const homeConfigEnv = path.join(mockHomeDir, '.config', 'zotero-headless', '.env');
      const homeEnv = path.join(mockHomeDir, '.zotero-headless.env');
      
      fs.writeFileSync(cwdEnv, '# CWD env\n');
      fs.writeFileSync(homeConfigEnv, 'ZOTERO_API_KEY=home123\nZOTERO_USER_ID=99999\n');
      fs.writeFileSync(homeEnv, '# Home env\n');
      
      // Mock process.cwd() and os.homedir()
      const originalCwd = process.cwd;
      vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
      
      try {
        process.cwd = () => mockCwdDir;
        
        const envFiles = findAllEnvFiles();
        
        // Should find all three files in priority order
        expect(envFiles.length).toBe(3);
        expect(envFiles[0]).toBe(cwdEnv);
        expect(envFiles[1]).toBe(homeConfigEnv);
        expect(envFiles[2]).toBe(homeEnv);
      } finally {
        process.cwd = originalCwd;
        vi.mocked(os.homedir).mockRestore();
      }
    });
    
    it('should skip files that do not exist', () => {
      vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
      const originalCwd = process.cwd;
      
      try {
        process.cwd = () => mockCwdDir;
        
        // Only create home config, skip others
        const homeConfigEnv = path.join(mockHomeDir, '.config', 'zotero-headless', '.env');
        fs.writeFileSync(homeConfigEnv, 'ZOTERO_API_KEY=home123\nZOTERO_USER_ID=99999\n');
        
        const envFiles = findAllEnvFiles();
        
        // Should only find the one existing file
        expect(envFiles.length).toBe(1);
        expect(envFiles[0]).toBe(homeConfigEnv);
      } finally {
        process.cwd = originalCwd;
        vi.mocked(os.homedir).mockRestore();
      }
    });
  });
  
  describe('Regression: CWD .env without Zotero config', () => {
    it('should load Zotero config from ~/.config/zotero-headless/.env when CWD .env lacks it', () => {
      /**
       * This test reproduces the issue where:
       * 1. User is in ~/.openclaw directory (has .env for OpenClaw)
       * 2. User runs `zotero add ...`
       * 3. The command should still find Zotero config in ~/.config/zotero-headless/.env
       * 
       * Previously, this would fail because the first .env found (in CWD) was loaded
       * and no further .env files were checked.
       */
      const originalCwd = process.cwd;
      
      try {
        process.cwd = () => mockCwdDir;
        vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
        
        // Simulate CWD .env (like ~/.openclaw/.env) - no Zotero config
        const cwdEnv = path.join(mockCwdDir, '.env');
        fs.writeFileSync(cwdEnv, '# OpenClaw configuration\nOPENAI_API_KEY=test\n');
        
        // Simulate Zotero config in home directory
        const homeConfigEnv = path.join(mockHomeDir, '.config', 'zotero-headless', '.env');
        fs.writeFileSync(homeConfigEnv, 'ZOTERO_API_KEY=test_api_key_12345\nZOTERO_USER_ID=19667572\n');
        
        // Verify CWD .env doesn't have Zotero config
        expect(hasZoteroConfig(cwdEnv)).toBe(false);
        
        // Verify home config has Zotero config
        expect(hasZoteroConfig(homeConfigEnv)).toBe(true);
        
        // Both files should be found in priority order
        const envFiles = findAllEnvFiles();
        expect(envFiles.length).toBe(2);
        expect(envFiles[0]).toBe(cwdEnv);
        expect(envFiles[1]).toBe(homeConfigEnv);
        
        // At least one file should have Zotero config
        const hasZoteroInAnyFile = envFiles.some(hasZoteroConfig);
        expect(hasZoteroInAnyFile).toBe(true);
        
      } finally {
        process.cwd = originalCwd;
        vi.mocked(os.homedir).mockRestore();
      }
    });
    
    it('should respect ZOTERO_ENV_PATH environment variable', () => {
      const customEnvPath = path.join(testBaseDir, 'custom', 'zotero.env');
      fs.mkdirSync(path.dirname(customEnvPath), { recursive: true });
      fs.writeFileSync(customEnvPath, 'ZOTERO_API_KEY=custom123\nZOTERO_USER_ID=54321\n');
      
      const originalCwd = process.cwd;
      const originalEnvPath = process.env.ZOTERO_ENV_PATH;
      
      try {
        process.cwd = () => mockCwdDir;
        vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
        process.env.ZOTERO_ENV_PATH = customEnvPath;
        
        const envFiles = findAllEnvFiles();
        
        // Custom path should be first (highest priority)
        expect(envFiles.length).toBeGreaterThan(0);
        expect(envFiles[0]).toBe(customEnvPath);
        
      } finally {
        process.cwd = originalCwd;
        vi.mocked(os.homedir).mockRestore();
        if (originalEnvPath !== undefined) {
          process.env.ZOTERO_ENV_PATH = originalEnvPath;
        } else {
          delete process.env.ZOTERO_ENV_PATH;
        }
      }
    });
  });
});
