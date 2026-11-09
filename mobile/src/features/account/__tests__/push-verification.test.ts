import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import type { MockClutch } from '../../../lib/clutch/testing';
import { clutchError, networkError } from '../../../lib/clutch/testing';
import {
  findVerificationCode,
  handlePushPayload,
  pendingVerification,
  rememberPendingVerification,
  submitVerificationCode,
  VERIFICATION_TASK,
} from '../push-verification';

jest.mock('../../../lib/clutch', () => {
  const actual = jest.requireActual('../../../lib/clutch');
  const { createMockClutch } = jest.requireActual('../../../lib/clutch/testing');
  return { ...actual, clutch: createMockClutch() };
});
const mockClutch = (jest.requireMock('../../../lib/clutch') as { clutch: MockClutch }).clutch;

const TOKEN = 'ExponentPushToken[abc]';
const LATER = '2999-01-01T00:00:00.000Z';
const REGISTERED = { status: 'registered', token: TOKEN, platform: 'ios', registeredAt: '2026-10-16T12:00:00.000Z' };

beforeEach(async () => {
  jest.clearAllMocks();
  await rememberPendingVerification(null);
  await SecureStore.deleteItemAsync('clutch.push.registered_token');
  mockClutch.me.verifyDevice.mockResolvedValue(REGISTERED as never);
});

describe('findVerificationCode', () => {
  const data = { type: 'clutch.device_verification', code: '123456' };

  it('reads the code from a foreground notification', () => {
    expect(findVerificationCode({ request: { content: { data } } })).toBe('123456');
  });

  it('reads the code from a background task payload (JSON dataString, iOS body)', () => {
    expect(findVerificationCode({ data: { dataString: JSON.stringify(data) } })).toBe('123456');
    expect(findVerificationCode({ data: { body: data } })).toBe('123456');
  });

  it('ignores ordinary notices', () => {
    expect(
      findVerificationCode({ notificationId: 'n1', type: 'booking_confirmed', clubId: 'c', link: '/notifications' }),
    ).toBeNull();
    expect(findVerificationCode('not json')).toBeNull();
  });
});

describe('submitVerificationCode', () => {
  it('posts the code for the pending token and records the registration', async () => {
    await rememberPendingVerification({ token: TOKEN, expiresAt: LATER });
    expect(await submitVerificationCode('123456')).toBe('registered');
    expect(mockClutch.me.verifyDevice).toHaveBeenCalledWith(
      { token: TOKEN, code: '123456' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(await pendingVerification()).toBeNull();
    expect(await SecureStore.getItemAsync('clutch.push.registered_token')).toBe(TOKEN);
  });

  it('does nothing without a pending registration, or after it expired', async () => {
    expect(await submitVerificationCode('123456')).toBe('none');
    await rememberPendingVerification({ token: TOKEN, expiresAt: '2000-01-01T00:00:00.000Z' });
    expect(await submitVerificationCode('123456')).toBe('none');
    expect(mockClutch.me.verifyDevice).not.toHaveBeenCalled();
  });

  it('drops a refused code (the next launch asks for a new one)', async () => {
    await rememberPendingVerification({ token: TOKEN, expiresAt: LATER });
    mockClutch.me.verifyDevice.mockRejectedValue(clutchError('device_verification_invalid'));
    expect(await submitVerificationCode('000000')).toBe('invalid');
    expect(await pendingVerification()).toBeNull();
  });

  it('keeps the pending registration when the answer did not arrive', async () => {
    await rememberPendingVerification({ token: TOKEN, expiresAt: LATER });
    mockClutch.me.verifyDevice.mockRejectedValue(networkError());
    expect(await submitVerificationCode('123456')).toBe('retry');
    expect(await pendingVerification()).toMatchObject({ token: TOKEN });
  });
});

describe('background delivery', () => {
  it('defines the task that handles a push received in the background', async () => {
    await rememberPendingVerification({ token: TOKEN, expiresAt: LATER });
    const tasks = (TaskManager as unknown as { __tasks: Map<string, (body: unknown) => Promise<void>> }).__tasks;
    const task = tasks.get(VERIFICATION_TASK);
    expect(task).toBeDefined();
    await task?.({ data: { dataString: JSON.stringify({ type: 'clutch.device_verification', code: '654321' }) }, error: null });
    expect(mockClutch.me.verifyDevice).toHaveBeenCalledWith({ token: TOKEN, code: '654321' }, expect.anything());
  });

  it('reports ordinary pushes as not a verification', async () => {
    expect(await handlePushPayload({ request: { content: { data: { type: 'booking_confirmed' } } } })).toBe(false);
  });
});
