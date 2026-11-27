export const TYPING_PRESENCE_TTL_MS = 3500;

export class TypingPresenceTimers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onExpire: (userId: string) => void,
    private readonly ttlMs = TYPING_PRESENCE_TTL_MS,
  ) {}

  start(userId: string) {
    if (!userId) return;
    this.stop(userId);
    this.timers.set(userId, setTimeout(() => {
      this.timers.delete(userId);
      this.onExpire(userId);
    }, this.ttlMs));
  }

  stop(userId: string) {
    const timer = this.timers.get(userId);
    if (timer) clearTimeout(timer);
    this.timers.delete(userId);
  }

  clear() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }
}
