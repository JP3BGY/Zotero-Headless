import { getDatabase, deletionLog } from './connection.js';

export interface LogDeletionParams {
  itemKey: string;
  libraryId: number;
  title?: string | null;
  itemType?: string | null;
  operationType: 'soft' | 'hard';
  caller: 'cli' | 'shell' | 'agent' | 'sync';
  rawJsonSnapshot?: string | null;
}

/**
 * Log a deletion operation to the audit trail
 */
export async function logDeletion(params: LogDeletionParams): Promise<void> {
  try {
    const db = getDatabase();
    await db.insert(deletionLog).values({
      itemKey: params.itemKey,
      libraryId: params.libraryId,
      title: params.title ?? null,
      itemType: params.itemType ?? null,
      operationType: params.operationType,
      caller: params.caller,
      rawJsonSnapshot: params.rawJsonSnapshot ?? null,
      deletedAt: Math.floor(Date.now() / 1000),
    }).run();
  } catch (error) {
    // Audit logging should never block the main operation
    console.warn('Warning: Failed to log deletion:', error);
  }
}
