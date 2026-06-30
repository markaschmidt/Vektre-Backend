import {
  accessLossReasonFromNotification,
  notificationTypeForAccessLoss,
  projectAccessLossMetadata,
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
