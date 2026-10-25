import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { UiDocumentRevisionRow } from '../models/ui-agent.model.js';
import { UiContextRepository } from '../repositories/ui-context.repository.js';
import { UiContextIndexRepository } from './ui-context-index.repository.js';
import { UiContextIndexService } from './ui-context-index.service.js';

@Injectable()
export class UiContextFreshnessService {
  constructor(
    private readonly index: UiContextIndexRepository,
    private readonly context: UiContextRepository,
    private readonly indexer: UiContextIndexService,
  ) {}

  async ensureCurrent(input: {
    projectId: string;
    documentId: string;
    documentKey: string;
  }): Promise<UiDocumentRevisionRow> {
    const latestSnapshot = await this.index.getLatestSnapshot(
      input.documentKey,
    );
    if (!latestSnapshot) {
      throw new ConflictException(
        'The GUI document must be persisted before starting an AI run',
      );
    }
    const currentRevision = await this.context.getLatestDocumentRevision(
      input.documentKey,
    );
    if (currentRevision?.snapshotId === latestSnapshot.snapshotId) {
      return currentRevision;
    }

    const timeoutMs = freshnessTimeoutMs();
    const result = await withTimeout(
      this.indexer.indexSnapshot({
        kind: 'snapshot',
        projectId: input.projectId,
        documentId: input.documentId,
        documentKey: input.documentKey,
        documentType: 'gui_screen',
        snapshotId: latestSnapshot.snapshotId,
        stateVector: latestSnapshot.stateVector ?? '',
        storageRef: latestSnapshot.storageRef,
      }),
      timeoutMs,
    );
    if (result.status === 'invalid') {
      throw new ConflictException({
        message: 'The latest GUI document is invalid and cannot be sent to AI',
        issues: result.validationIssues,
      });
    }
    const revision =
      result.revision ??
      (await this.context.getLatestDocumentRevision(input.documentKey));
    if (!revision || revision.snapshotId !== latestSnapshot.snapshotId) {
      throw new ServiceUnavailableException(
        'The latest GUI snapshot could not be indexed',
      );
    }
    return revision;
  }
}

function freshnessTimeoutMs(): number {
  const value = Number(process.env.UI_CONTEXT_FRESHNESS_TIMEOUT_MS ?? '5000');
  return Number.isFinite(value) && value >= 100 && value <= 30_000
    ? Math.floor(value)
    : 5_000;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ServiceUnavailableException(
                'Timed out catching up the UI context index',
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
