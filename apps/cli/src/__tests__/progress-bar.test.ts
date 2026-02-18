// ProgressBar Component Tests
// Unit tests for CLI progress bar

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProgressBar } from '../progress-bar.js';

describe('ProgressBar', () => {
  let stdoutWrite: any;
  let stdoutOutput: string[];
  
  beforeEach(() => {
    stdoutOutput = [];
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutOutput.push(chunk.toString());
      return true;
    });
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    stdoutWrite.mockRestore();
    vi.useRealTimers();
  });
  
  describe('Initialization', () => {
    it('should create progress bar with default options', () => {
      const pb = new ProgressBar({ total: 100 });
      expect(pb).toBeDefined();
    });
    
    it('should create progress bar with custom width', () => {
      const pb = new ProgressBar({ total: 100, width: 20 });
      expect(pb).toBeDefined();
    });
    
    it('should create progress bar with label', () => {
      const pb = new ProgressBar({ total: 100, label: 'Downloading' });
      expect(pb).toBeDefined();
    });
    
    it('should handle zero total gracefully', () => {
      const pb = new ProgressBar({ total: 0 });
      pb.update(0);
      expect(stdoutOutput.length).toBeGreaterThan(0);
    });
  });
  
  describe('Progress Updates', () => {
    it('should display progress bar with correct percentage', () => {
      const pb = new ProgressBar({ total: 100, width: 40 });
      pb.update(50);
      
      expect(stdoutOutput[0]).toContain('50%');
      expect(stdoutOutput[0]).toContain('(50/100)');
    });
    
    it('should update bar fill correctly', () => {
      const pb = new ProgressBar({ total: 100, width: 10 });
      pb.update(30);
      
      // 30% of 10 chars = 3 filled
      expect(stdoutOutput[0]).toMatch(/███/);
    });
    
    it('should not exceed total', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(150);
      
      expect(stdoutOutput[0]).toContain('100%');
      expect(stdoutOutput[0]).toContain('(100/100)');
    });
    
    it('should handle label updates', () => {
      const pb = new ProgressBar({ total: 100, label: 'Phase 1' });
      pb.update(50, 'Phase 2');
      
      expect(stdoutOutput[0]).toContain('Phase 2');
    });
    
    it('should increment by one', () => {
      const pb = new ProgressBar({ total: 10 });
      pb.increment();
      
      expect(stdoutOutput[0]).toContain('10%');
      expect(stdoutOutput[0]).toContain('(1/10)');
    });
    
    it('should increment with label', () => {
      const pb = new ProgressBar({ total: 10 });
      pb.increment('Processing...');
      
      expect(stdoutOutput[0]).toContain('Processing...');
    });
  });
  
  describe('ANSI Escape Sequences', () => {
    it('should use carriage return to move cursor', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      
      expect(stdoutOutput[0]).toMatch(/^\r/);
    });
    
    it('should clear line before redrawing', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      
      expect(stdoutOutput[0]).toContain('\x1b[K');
    });
    
    it('should render multiple updates on same line', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(25);
      pb.update(50);
      pb.update(75);
      
      // Each update should start with \r
      expect(stdoutOutput[0]).toMatch(/^\r/);
      expect(stdoutOutput[1]).toMatch(/^\r/);
      expect(stdoutOutput[2]).toMatch(/^\r/);
    });
  });
  
  describe('Completion', () => {
    it('should complete with newline', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.complete();
      
      expect(stdoutOutput[stdoutOutput.length - 1]).toContain('\n');
    });
    
    it('should show 100% when completed', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      pb.complete();
      
      const lastOutput = stdoutOutput[stdoutOutput.length - 2];
      expect(lastOutput).toContain('100%');
      expect(lastOutput).toContain('(100/100)');
    });
    
    it('should display completion message', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.complete('Download finished!');
      
      const lastOutput = stdoutOutput[stdoutOutput.length - 1];
      expect(lastOutput).toContain('Download finished!');
    });
    
    it('should handle complete without message', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.complete();
      
      // Should still work without error
      expect(stdoutOutput.length).toBeGreaterThan(0);
    });
  });
  
  describe('Stop', () => {
    it('should stop with newline', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      pb.stop();
      
      expect(stdoutOutput[stdoutOutput.length - 1]).toContain('\n');
    });
    
    it('should not complete progress when stopped', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      pb.stop();
      
      const lastOutput = stdoutOutput[stdoutOutput.length - 2];
      expect(lastOutput).toContain('50%');
      expect(lastOutput).not.toContain('100%');
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle very large totals', () => {
      const pb = new ProgressBar({ total: 1000000 });
      pb.update(500000);
      
      expect(stdoutOutput[0]).toContain('50%');
      expect(stdoutOutput[0]).toContain('(500000/1000000)');
    });
    
    it('should handle single item', () => {
      const pb = new ProgressBar({ total: 1 });
      pb.update(0);
      expect(stdoutOutput[0]).toContain('0%');
      
      pb.complete();
      expect(stdoutOutput[stdoutOutput.length - 2]).toContain('100%');
    });
    
    it('should handle negative current gracefully', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(-10);
      
      expect(stdoutOutput[0]).toContain('0%');
    });
    
    it('should display elapsed time', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      
      expect(stdoutOutput[0]).toMatch(/\[\d+\.\d+s\]$/);
    });
    
    it('should handle empty label', () => {
      const pb = new ProgressBar({ total: 100 });
      pb.update(50);
      
      // Should work without label
      expect(stdoutOutput[0]).toContain('50%');
    });
  });
  
  describe('Visual Format', () => {
    it('should format with filled and empty characters', () => {
      const pb = new ProgressBar({ total: 100, width: 10 });
      pb.update(50);
      
      // Should have 5 filled (█) and 5 empty (░) chars
      const output = stdoutOutput[0];
      expect(output).toMatch(/█{5}/);
      expect(output).toMatch(/░{5}/);
    });
    
    it('should format with correct width', () => {
      const pb = new ProgressBar({ total: 100, width: 20 });
      pb.update(50);
      
      const match = stdoutOutput[0].match(/\[(█+░*)\]/);
      expect(match).toBeTruthy();
      expect(match![1].length).toBe(20);
    });
  });
});
