// Sync Engine Tests
// Tests for Phase 2: Two-Way Sync

import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictResolver } from '../conflict.js';

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;
  
  beforeEach(() => {
    resolver = new ConflictResolver();
  });
  
  describe('resolveItemConflict', () => {
    it('should resolve when only remote changed', () => {
      const base = { title: 'Original', author: 'John' };
      const local = { title: 'Original', author: 'John' };  // Same as base
      const remote = { title: 'Remote Title', author: 'John' }; // Changed
      
      const result = resolver.resolveItemConflict(base, local, remote);
      
      expect(result.type).toBe('resolved');
      expect(result.data.title).toBe('Remote Title');
    });
    
    it('should resolve when only local changed', () => {
      const base = { title: 'Original' };
      const local = { title: 'Local Title' };  // Changed locally
      const remote = { title: 'Original' };   // Same as base
      
      const result = resolver.resolveItemConflict(base, local, remote);
      
      expect(result.type).toBe('resolved');
      expect(result.data.title).toBe('Local Title');
    });
    
    it('should detect conflict when both changed differently', () => {
      const base = { title: 'Original' };
      const local = { title: 'Local Title' };
      const remote = { title: 'Remote Title' };
      
      const result = resolver.resolveItemConflict(base, local, remote);
      
      expect(result.type).toBe('conflict');
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].field).toBe('title');
      expect(result.conflicts[0].local).toBe('Local Title');
      expect(result.conflicts[0].remote).toBe('Remote Title');
    });
    
    it('should resolve when both changed the same way', () => {
      const base = { title: 'Original' };
      const local = { title: 'Same Change' };
      const remote = { title: 'Same Change' };
      
      const result = resolver.resolveItemConflict(base, local, remote);
      
      expect(result.type).toBe('resolved');
      expect(result.data.title).toBe('Same Change');
    });
    
    it('should handle multiple fields', () => {
      const base = { title: 'Original', author: 'Original Author', year: '2023' };
      const local = { title: 'Local', author: 'Local Author', year: '2024' };
      const remote = { title: 'Remote', author: 'Remote Author', year: '2024' };
      
      const result = resolver.resolveItemConflict(base, local, remote);
      
      expect(result.type).toBe('conflict');
      // title: both changed differently -> conflict
      // author: both changed differently -> conflict  
      // year: both changed to same value -> resolved
      expect(result.conflicts.length).toBe(2);
    });
    
    it('should handle nested objects', () => {
      const base = { title: 'Original', creators: [] };
      const local = { title: 'Local', creators: [{ firstName: 'John' }] };
      const remote = { title: 'Remote', creators: [{ firstName: 'Jane' }] };
      
      const result = resolver.resolveItemConflict(base, local, remote);
      
      expect(result.type).toBe('conflict');
    });
  });
  
  describe('autoResolve', () => {
    it('should auto-resolve non-conflicting changes', () => {
      const base = { title: 'Original', author: 'John' };
      const local = { title: 'Local Title', author: 'John' };
      const remote = { title: 'Remote Title', author: 'John' };
      
      const { resolved, conflicts } = resolver.autoResolve(base, local, remote);
      
      expect(conflicts.length).toBe(1);
      expect(resolved.author).toBe('John');
    });
    
    it('should return empty conflicts when fully resolved', () => {
      const base = { title: 'Original' };
      const local = { title: 'Local Title' };
      const remote = { title: 'Original' };
      
      const { resolved, conflicts } = resolver.autoResolve(base, local, remote);
      
      expect(conflicts.length).toBe(0);
      expect(resolved.title).toBe('Local Title');
    });
  });
});
