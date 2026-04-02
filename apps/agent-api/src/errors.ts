/**
 * Structured Error System for Agent API
 *
 * Provides machine-parseable error codes, recovery suggestions,
 * and recoverability flags for AI agent consumption.
 */

// ============ Error Code Registry ============

export const ErrorCode = {
  // Item errors
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  ITEM_TYPE_INVALID: 'ITEM_TYPE_INVALID',
  ITEM_FIELD_INVALID: 'ITEM_FIELD_INVALID',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BATCH_LIMIT_EXCEEDED: 'BATCH_LIMIT_EXCEEDED',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  // Sync errors
  SYNC_ERROR: 'SYNC_ERROR',
  SYNC_IN_PROGRESS: 'SYNC_IN_PROGRESS',
  INVALID_STRATEGY: 'INVALID_STRATEGY',

  // External API errors
  API_ERROR: 'API_ERROR',
  RATE_LIMIT: 'RATE_LIMIT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  IDENTIFIER_NOT_FOUND: 'IDENTIFIER_NOT_FOUND',
  TRANSLATOR_ERROR: 'TRANSLATOR_ERROR',

  // Config errors
  CONFIG_ERROR: 'CONFIG_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  NO_LIBRARY: 'NO_LIBRARY',

  // Internal
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

// ============ Base Error Class ============

export class ZoteroError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>,
    public suggestion?: string,
    public recoverable: boolean = false,
  ) {
    super(message);
    this.name = 'ZoteroError';
  }

  /** Serialize to a plain object for structured logging / agent consumption */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}

// ============ Specific Error Subclasses ============

export class ItemNotFoundError extends ZoteroError {
  constructor(public itemKey: string, suggestions?: string[]) {
    super(
      `Item not found: ${itemKey}`,
      ErrorCode.ITEM_NOT_FOUND,
      { itemKey, suggestions },
      suggestions?.length
        ? `Did you mean: ${suggestions.join(', ')}?`
        : 'Check the item key and ensure the item has not been permanently deleted.',
      false,
    );
    this.name = 'ItemNotFoundError';
  }
}

export class ValidationError extends ZoteroError {
  constructor(message: string, public field?: string, suggestion?: string) {
    super(
      message,
      ErrorCode.VALIDATION_ERROR,
      { field },
      suggestion ?? (field ? `Check the '${field}' field value.` : undefined),
      true,
    );
    this.name = 'ValidationError';
  }
}

export class BatchLimitError extends ZoteroError {
  constructor(requested: number, limit: number, entityType: string = 'items') {
    super(
      `Batch limit exceeded: ${requested} ${entityType} requested, maximum is ${limit}.`,
      ErrorCode.BATCH_LIMIT_EXCEEDED,
      { requested, limit, entityType },
      `Split the operation into batches of ${limit} or fewer.`,
      true,
    );
    this.name = 'BatchLimitError';
  }
}

export class SyncError extends ZoteroError {
  constructor(message: string, public phase: string) {
    super(
      message,
      ErrorCode.SYNC_ERROR,
      { phase },
      'Try running sync again. If the problem persists, check network connectivity.',
      true,
    );
    this.name = 'SyncError';
  }
}

export class ConfigError extends ZoteroError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      ErrorCode.CONFIG_ERROR,
      undefined,
      suggestion ?? 'Run "zotero config" to check your configuration.',
      true,
    );
    this.name = 'ConfigError';
  }
}

export class IdentifierNotFoundError extends ZoteroError {
  constructor(identifierType: string, identifierValue: string) {
    super(
      `${identifierType} not found: ${identifierValue}`,
      ErrorCode.IDENTIFIER_NOT_FOUND,
      { identifierType, identifierValue },
      `Verify the ${identifierType} is correct. You can create the item manually using createItem().`,
      false,
    );
    this.name = 'IdentifierNotFoundError';
  }
}

export class RateLimitError extends ZoteroError {
  constructor(retryAfterMs?: number) {
    super(
      'Rate limit exceeded. Please slow down requests.',
      ErrorCode.RATE_LIMIT,
      { retryAfterMs },
      retryAfterMs
        ? `Wait ${Math.ceil(retryAfterMs / 1000)} seconds before retrying.`
        : 'Wait a moment before retrying.',
      true,
    );
    this.name = 'RateLimitError';
  }
}
