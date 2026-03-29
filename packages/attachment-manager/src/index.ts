// Attachment Manager Entry Point

export { AttachmentManager, attachmentManager } from './manager.js';
export type { AttachmentInfo, AttachmentListOptions, AttachmentSyncOptions } from './manager.js';

export { FullTextFinder } from './fulltext-finder.js';
export type { BatchFindResult } from './fulltext-finder.js';

export { DomainRateLimiter } from './domain-rate-limiter.js';
export { isAllowedFileType, sniffMimeType, getExtensionForMimeType, ALLOWED_MIME_TYPES } from './file-validator.js';

export { buildResolvers, canFindFileForItem } from './resolvers/index.js';
export type {
  UrlResolverEntry,
  Resolver,
  CustomResolverConfig,
  FindResult,
  FullTextFinderOptions,
} from './resolvers/types.js';
