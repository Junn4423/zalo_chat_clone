const mockIo = jest.fn();

jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

jest.mock('../src/services/client', () => ({
  __esModule: true,
  default: {post: jest.fn()},
}));

jest.mock('../src/services/ChatAPI/outbox', () => ({
  enqueueOutboxMessage: jest.fn(),
  getOutboxMessages: jest.fn(() => []),
  markOutboxAttempted: jest.fn(),
  removeOutboxMessage: jest.fn(),
  retryOutboxMessage: jest.fn(),
}));

import {connectSocket, disconnectSocket, joinChatRooms} from '../src/utils/socket';

const createSocketMock = (_url: string, options: any) => {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const instance: any = {
    auth: options.auth,
    connected: false,
    id: 'test-socket',
    handlers,
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
      return instance;
    }),
    disconnect: jest.fn(),
    emit: jest.fn(),
    timeout: jest.fn(() => instance),
  };
  return instance;
};

describe('authenticated socket identity', () => {
  beforeEach(() => {
    disconnectSocket();
    mockIo.mockReset();
    mockIo.mockImplementation(createSocketMock);
  });

  afterEach(() => disconnectSocket());

  it('reuses the socket only for the same account and token', () => {
    const first = connectSocket('ACCOUNT_A', 'token-a');
    expect(connectSocket('ACCOUNT_A', 'token-a')).toBe(first);
    expect(mockIo).toHaveBeenCalledTimes(1);

    const second = connectSocket('ACCOUNT_B', 'token-b');
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(second.auth).toEqual({userId: 'ACCOUNT_B', token: 'token-b'});
    expect(mockIo).toHaveBeenCalledTimes(2);
  });

  it('recreates the socket when the same account receives a fresh token', () => {
    const first = connectSocket('ACCOUNT_A', 'old-token');
    const renewed = connectSocket('ACCOUNT_A', 'fresh-token');

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(renewed).not.toBe(first);
    expect((renewed as any).auth.token).toBe('fresh-token');
  });

  it('ignores heartbeat and connect callbacks from a replaced socket', () => {
    const first = connectSocket('ACCOUNT_A', 'token-a');
    const second = connectSocket('ACCOUNT_B', 'token-b');

    (first as any).handlers.ping('old-heartbeat');
    (first as any).handlers.connect();

    expect(first.emit).not.toHaveBeenCalled();
    expect(second.emit).not.toHaveBeenCalled();
  });

  it('joins the current room list in bounded batches and returns only acknowledged rooms', async () => {
    const active = connectSocket('ACCOUNT_A', 'token-a') as any;
    active.connected = true;
    active.emit.mockImplementation((event: string, payload: any, callback: (error: Error | null, response?: any) => void) => {
      if (event === 'joinRoom') callback(null, {success: payload.roomId !== 'room_denied'});
    });

    const roomIds = [...Array.from({length: 21}, (_, index) => `room_${index}`), 'room_0', 'room_denied'];
    const joined = await joinChatRooms(roomIds);

    expect(active.emit.mock.calls.filter((call: any[]) => call[0] === 'joinRoom')).toHaveLength(22);
    expect(joined).toHaveLength(21);
    expect(joined).not.toContain('room_denied');
  });
});
