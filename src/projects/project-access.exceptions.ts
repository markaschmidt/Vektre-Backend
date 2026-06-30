import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { ProjectAccessDenialReason } from '../integrations/app-data.types.js';
import {
  PROJECT_ACCESS_LOSS_ERROR_CODES,
  type ProjectAccessLossReason,
} from '../notifications/models/notification.model.js';

export class ProjectDeletedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.GONE,
        error: PROJECT_ACCESS_LOSS_ERROR_CODES.deleted,
        message: 'This project was deleted.',
        reason: 'deleted' satisfies ProjectAccessLossReason,
      },
      HttpStatus.GONE,
    );
  }
}

export class ProjectAccessRevokedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: PROJECT_ACCESS_LOSS_ERROR_CODES.removed,
        message: 'You no longer have access to this project.',
        reason: 'removed' satisfies ProjectAccessLossReason,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

export function throwProjectAccessDenied(reason: ProjectAccessDenialReason): never {
  switch (reason) {
    case 'deleted':
      throw new ProjectDeletedException();
    case 'removed':
      throw new ProjectAccessRevokedException();
    default:
      throw new NotFoundException('Project not found');
  }
}
