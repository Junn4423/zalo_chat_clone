import {TypingPresenceTimers, TYPING_PRESENCE_TTL_MS} from '../src/utils/typingPresence';

describe('typing presence expiry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('expires an indicator when its stop event was missed', () => {
    const onExpire = jest.fn();
    const timers = new TypingPresenceTimers(onExpire);

    timers.start('peer-a');
    jest.advanceTimersByTime(TYPING_PRESENCE_TTL_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(onExpire).toHaveBeenCalledWith('peer-a');
  });

  it('restarts the timeout on a fresh typing event', () => {
    const onExpire = jest.fn();
    const timers = new TypingPresenceTimers(onExpire);

    timers.start('peer-a');
    jest.advanceTimersByTime(TYPING_PRESENCE_TTL_MS - 500);
    timers.start('peer-a');
    jest.advanceTimersByTime(500);
    expect(onExpire).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TYPING_PRESENCE_TTL_MS - 500);

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('cancels one user or all pending indicators when stop/cleanup arrives', () => {
    const onExpire = jest.fn();
    const timers = new TypingPresenceTimers(onExpire);

    timers.start('peer-a');
    timers.start('peer-b');
    timers.stop('peer-a');
    timers.clear();
    jest.advanceTimersByTime(TYPING_PRESENCE_TTL_MS);

    expect(onExpire).not.toHaveBeenCalled();
  });
});
