// Retry utility with exponential backoff
// See Zotero-Headless-Complete-Design.md Section 5.3

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryableErrors?: ((error: Error) => boolean)[];
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryableErrors: [],
};

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute operation with retry and exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Check if we should retry
      if (attempt === opts.maxRetries) break;
      
      // Check if error is retryable
      if (opts.retryableErrors.length > 0) {
        const isRetryable = opts.retryableErrors.some(check => check(lastError));
        if (!isRetryable) throw lastError;
      }
      
      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt),
        opts.maxDelay
      );
      const jitter = Math.random() * 1000;
      
      console.log(`   Retrying in ${delay + jitter}ms (attempt ${attempt + 1}/${opts.maxRetries})...`);
      await sleep(delay + jitter);
    }
  }
  
  throw lastError!;
}

/**
 * Common retryable error patterns
 */
export const RETRYABLE_ERRORS = {
  network: (error: Error) => error.message.includes('fetch') || error.message.includes('network'),
  rateLimit: (error: Error) => error.message.includes('429') || error.message.includes('rate limit'),
  timeout: (error: Error) => error.message.includes('timeout'),
  serverError: (error: Error) => error.message.includes('5'),
  concurrentUpdate: (error: Error) => error.message.includes('412') || error.message.includes('Precondition Failed'),
};

/**
 * Concurrent update error - indicates remote was modified
 */
export class ConcurrentUpdateError extends Error {
  constructor(message = 'Remote was modified') {
    super(message);
    this.name = 'ConcurrentUpdateError';
  }
}
