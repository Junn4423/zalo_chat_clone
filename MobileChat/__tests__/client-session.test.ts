const mockResponseUse = jest.fn();
const mockGetAuthState = jest.fn();
const mockRemoveToken = jest.fn();
const mockInvalidateSocketSession = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({
      interceptors: {
        request: {use: jest.fn()},
        response: {use: mockResponseUse},
      },
    })),
  },
}));

jest.mock('../src/auth/store/login.store', () => ({
  useAuthStore: {getState: () => ({...mockGetAuthState(), logout: jest.fn()})},
}));

jest.mock('../src/auth/utils/storage', () => ({
  removeToken: (...args: unknown[]) => mockRemoveToken(...args),
}));

jest.mock('../src/services/sessionLifecycle', () => ({
  invalidateSocketSession: (...args: unknown[]) => mockInvalidateSocketSession(...args),
}));

require('../src/services/client');

const getRejectedResponseHandler = () => mockResponseUse.mock.calls[0][1] as (error: any) => Promise<never>;

describe('API session expiry handling', () => {
  beforeEach(() => {
    mockGetAuthState.mockReset();
    mockRemoveToken.mockReset();
    mockInvalidateSocketSession.mockReset();
    mockRemoveToken.mockResolvedValue(undefined);
  });

  it('disconnects the socket and clears the current session on its 401', async () => {
    mockGetAuthState.mockReturnValue({auth: {token: 'current-token'}});
    const error = {response: {status: 401}, config: {headers: {Authorization: 'Bearer current-token'}}};

    await expect(getRejectedResponseHandler()(error)).rejects.toBe(error);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(mockInvalidateSocketSession).toHaveBeenCalledTimes(1);
    expect(mockRemoveToken).toHaveBeenCalledTimes(1);
  });

  it('does not disconnect a newer account for a late 401 from an old request', async () => {
    mockGetAuthState.mockReturnValue({auth: {token: 'new-token'}});
    const error = {response: {status: 401}, config: {headers: {Authorization: 'Bearer old-token'}}};

    await expect(getRejectedResponseHandler()(error)).rejects.toBe(error);

    expect(mockInvalidateSocketSession).not.toHaveBeenCalled();
    expect(mockRemoveToken).not.toHaveBeenCalled();
  });
});
