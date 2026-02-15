// Retry Utility Tests
// Tests for Phase 2: Error Handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, RETRYABLE_ERRORS, ConcurrentUpdateError } from '../retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });
  
  it('should return result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    
    const result = await withRetry(operation, { maxRetries: 0 });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });
  
  it('should not retry when maxRetries is 0', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));
    
    await expect(
      withRetry(operation, { maxRetries: 0 })
    ).rejects.toThrow('fail');
    
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('RETRYABLE_ERRORS', () => {
  it('should detect network errors', () => {
    expect(RETRYABLE_ERRORS.network(new Error('fetch failed'))).toBe(true);
    expect(RETRYABLE_ERRORS.network(new Error('network error'))).toBe(true);
    expect(RETRYABLE_ERRORS.network(new Error('some other error'))).toBe(false);
  });
  
  it('should detect rate limit errors', () => {
    expect(RETRYABLE_ERRORS.rateLimit(new Error('429 Too Many Requests'))).toBe(true);
    expect(RETRYABLE_ERRORS.rateLimit(new Error('rate limit exceeded'))).toBe(true);
    expect(RETRYABLE_ERRORS.rateLimit(new Error('other error'))).toBe(false);
  });
  
  it('should detect concurrent update errors', () => {
    expect(RETRYABLE_ERRORS.concurrentUpdate(new Error('412 Precondition Failed'))).toBe(true);
    expect(RETRYABLE_ERRORS.concurrentUpdate(new Error('Precondition Failed'))).toBe(true);
    expect(RETRYABLE_ERRORS.concurrentUpdate(new Error('other error'))).toBe(false);
  });
});

describe('ConcurrentUpdateError', () => {
  it('should create error with default message', () => {
    const error = new ConcurrentUpdateError();
    expect(error.name).toBe('ConcurrentUpdateError');
    expect(error.message).toBe('Remote was modified');
  });
  
  it('should create error with custom message', () => {
    const error = new ConcurrentUpdateError('Custom message');
    expect(error.message).toBe('Custom message');
  });
});
