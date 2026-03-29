// @ts-nocheck

import type { Command } from '../types.js';
import { syncCommands } from './sync.js';
import { listCommands } from './list.js';
import { searchCommands } from './search.js';
import { getCommands } from './get.js';
import { statsCommands } from './stats.js';
import { verifyCommands } from './verify.js';
import { addCommands } from './add.js';
import { addByIdCommands } from './add-by-id.js';
import { updateCommands } from './update.js';
import { deleteCommands } from './delete.js';
import { exportCommands } from './export-cmd.js';
import { tagsCommands } from './tags.js';
import { collectionsCommands } from './collections.js';
import { attachmentCommands } from './attachments.js';
import { webdavCommands } from './webdav.js';
import { noteCommands } from './note.js';
import { annotationCommands } from './annotations.js';
import { trashCommands } from './trash.js';
import { citeCommands } from './cite.js';
import { batchCommands } from './batch.js';
import { creatorsCommands } from './creators.js';
import { duplicatesCommands } from './duplicates.js';
import { relatedCommands } from './related.js';
import { searchesCommands } from './searches.js';
import { groupsCommands } from './groups.js';
import { configCommands } from './config.js';
import { historyCommands } from './history.js';
import { helpCommands } from './help.js';
import { shellCommands } from './shell.js';
import { importCommands } from './import-cmd.js';
import { mvCommands } from './mv.js';

export const commands: Command[] = [
  ...syncCommands,
  ...attachmentCommands,
  ...groupsCommands,
  ...tagsCommands,
  ...collectionsCommands,
  ...listCommands,
  ...searchCommands,
  ...getCommands,
  ...statsCommands,
  ...verifyCommands,
  ...addCommands,
  ...updateCommands,
  ...deleteCommands,
  ...exportCommands,
  ...addByIdCommands,
  ...noteCommands,
  ...annotationCommands,
  ...configCommands,
  ...historyCommands,
  ...helpCommands,
  ...shellCommands,
  ...trashCommands,
  ...searchesCommands,
  ...duplicatesCommands,
  ...relatedCommands,
  ...citeCommands,
  ...batchCommands,
  ...creatorsCommands,
  ...webdavCommands,
  ...importCommands,
  ...mvCommands,
];
