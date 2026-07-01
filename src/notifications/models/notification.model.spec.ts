import {
  accessLossReasonFromNotification,
  notificationTypeForAccessLoss,
  projectAccessLossMetadata,
  projectMemberJoinNotifyRecipientIds,
  PROJECT_ACCESS_LOSS_ERROR_CODES,
  PROJECT_ACCESS_LOSS_NOTIFICATION_TYPES,
} from './notification.model.js';

describe('project access loss notification helpers', () => {
  it('maps notification types to access-loss reasons', () => {
    expect(accessLossReasonFromNotification('project_removed')).toBe('removed');
    expect(accessLossReasonFromNotification('project_deleted')).toBe('deleted');
    expect(accessLossReasonFromNotification('project_invitation')).toBeNull();
  });

  it('maps access-loss reasons to notification types and API error codes', () => {
    expect(notificationTypeForAccessLoss('removed')).toBe('project_removed');
    expect(notificationTypeForAccessLoss('deleted')).toBe('project_deleted');
    expect(PROJECT_ACCESS_LOSS_NOTIFICATION_TYPES.removed).toBe('project_removed');
    expect(PROJECT_ACCESS_LOSS_ERROR_CODES.deleted).toBe('PROJECT_DELETED');
  });

  it('includes reason in notification metadata', () => {
    expect(
      projectAccessLossMetadata({ reason: 'removed', previousRole: 'editor' }),
    ).toEqual({
      reason: 'removed',
      previousRole: 'editor',
    });
  });
});

describe('projectMemberJoinNotifyRecipientIds', () => {
  it('notifies owners and editors but not viewers or the joiner', () => {
    expect(
      projectMemberJoinNotifyRecipientIds({
        ownerUserId: 'owner-1',
        joinedUserId: 'new-user',
        members: [
          { userId: 'owner-1', role: 'owner' },
          { userId: 'editor-1', role: 'editor' },
          { userId: 'viewer-1', role: 'viewer' },
          { userId: 'new-user', role: 'viewer' },
        ],
      }),
    ).toEqual(expect.arrayContaining(['owner-1', 'editor-1']));
  });

  it('always includes the project owner even without a member row', () => {
    expect(
      projectMemberJoinNotifyRecipientIds({
        ownerUserId: 'owner-1',
        joinedUserId: 'new-user',
        members: [{ userId: 'new-user', role: 'editor' }],
      }),
    ).toEqual(['owner-1']);
  });
});
