import { NotFoundException } from '@nestjs/common';
import {
  ProjectAccessRevokedException,
  ProjectDeletedException,
  throwProjectAccessDenied,
} from './project-access.exceptions.js';

describe('throwProjectAccessDenied', () => {
  it('throws PROJECT_DELETED with 410 for deleted projects', () => {
    expect(() => throwProjectAccessDenied('deleted')).toThrow(ProjectDeletedException);
    try {
      throwProjectAccessDenied('deleted');
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDeletedException);
      const response = (err as ProjectDeletedException).getResponse() as Record<string, unknown>;
      expect(response.error).toBe('PROJECT_DELETED');
      expect(response.reason).toBe('deleted');
    }
  });

  it('throws PROJECT_ACCESS_REVOKED with 403 for removed members', () => {
    expect(() => throwProjectAccessDenied('removed')).toThrow(ProjectAccessRevokedException);
    try {
      throwProjectAccessDenied('removed');
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectAccessRevokedException);
      const response = (err as ProjectAccessRevokedException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.error).toBe('PROJECT_ACCESS_REVOKED');
      expect(response.reason).toBe('removed');
    }
  });

  it('throws 404 for unknown projects', () => {
    expect(() => throwProjectAccessDenied('not_found')).toThrow(NotFoundException);
  });
});
