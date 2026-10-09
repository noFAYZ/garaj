/** The weekly recall sweep. Idempotent: the dedupe key absorbs a second run. */

import { scanForRecalls } from '@vehicle-os/api/recall-scan';
import type { JobHandler } from './index';

export const scanRecalls: JobHandler = async (_job, { db, log }) => {
  const result = await scanForRecalls(db);
  log.info(result, 'Recall scan complete');
};
