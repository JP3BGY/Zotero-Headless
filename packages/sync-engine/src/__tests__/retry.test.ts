// Retry Utility Tests
// Tests for Phase 2: Error Handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, RETRYABLE_ERRORS, ConcurrentUpdateError } from '../retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  it('should return result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    
    const result = await withRetry(operation);
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });
  
  it('should retry on failure and succeed', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockResolvedValue('success');
    
    const result = await withRetry(operation, { maxRetries: 3 });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('should retry multiple times', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success');
    
    const result = await withRetry(operation, { maxRetries: 3, baseDelay: 100 });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });
  
  it('should throw after max retries exceeded', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Persistent failure'));
    
    await expect(
      withRetry(operation, { maxRetries: 2, baseDelay: 100 })
    ).rejects.toThrow('Persistent failure');
    
    expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
  
  it('should respect retryableErrors filter', async () => {
    const retryableError = new Error('Rate limited');
    const operation = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue('success');
    
    const result = await withRetry(operation, {
      maxRetries: 3,
      retryableErrors: [(e) => e.message.includes('Rate limited')],
    });
    
    expect(result).toBe('success');
  });
  
  it('should not retry non-retryable errors', async () => {
    const nonRetryableError = new Error('Bad request');
    const operation = vi.fn().mockRejectedValue(nonRetryableError);
    
    await expect(
      withRetry(operation, {
        maxRetries: 3,
        retryableErrors: [(e) => e.message.includes('Rate limited')],
      })
    ).rejects.toThrow('Bad request');
    
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('RETRYABLE_ERRORS', () => {
  it('should detect network errors', () => {
    expect(RETRYABLE_ERRORS.network(new Error('fetch failed'))).toBe(true);
    expect(RETRYABLE_ERRORS.network(new Error('Network error'))).toBe(true);
    expect(RETRYABLE_ERRORS.network(new Error('Other error'))).toBe(false);
  });
  
  it('should detect rate limit errors', () => {
    expect(RETRYABLE_ERRORS.rateLimit(new Error('429 Too Many Requests'))).toBe(true);
    expect(RETRYABLE_ERRORS.rateLimit(new Error('rate limit exceeded'))).toBe(true);
    expect(RETRYABLE_ERRORS.rateLimit(new Error('Other error'))).toBe(false);
  });
  
  it('should detect concurrent update errors', () => {
    expect(RETRYABLE_ERRORS.concurrentUpdate(new Error('412 Precondition Failed'))).toBe(true);
    expect(RETRYABLE_ERRORS.concurrentUpdate(new Error('Precondition Failed'))).toBe(true);
    expect(RETRYABLE_ERRORS.concurrentUpdate(new Error('Other error'))).toBe(false);
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
