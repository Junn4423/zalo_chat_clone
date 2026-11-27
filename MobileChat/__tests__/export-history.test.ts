import {fetchExportHistory, EXPORT_HISTORY_MAX_PAGES, EXPORT_HISTORY_PAGE_SIZE} from '../src/services/ChatAPI/exportHistory';
import {ExportableChatMessage} from '../src/services/ChatAPI/api';

const makeMessage = (id: number): ExportableChatMessage => ({
  _id: String(id),
  userId: 'qa-user',
  timestamp: new Date(id * 1000).toISOString(),
});

describe('conversation history export paging', () => {
  it('stops when the server reports the last page', async () => {
    const loadPage = jest.fn(async (_roomId: string, page: number) => ({
      messages: [makeMessage(page)],
      hasMore: false,
    }));

    const result = await fetchExportHistory('qa-room', loadPage);

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledWith('qa-room', 1, EXPORT_HISTORY_PAGE_SIZE);
    expect(result).toEqual({messages: [makeMessage(1)], limited: false});
  });

  it('stops at 2,000 messages and reports older history as omitted', async () => {
    const loadPage = jest.fn(async (_roomId: string, page: number) => ({
      messages: Array.from({length: EXPORT_HISTORY_PAGE_SIZE}, (_, index) => makeMessage((page - 1) * EXPORT_HISTORY_PAGE_SIZE + index)),
      hasMore: true,
    }));

    const result = await fetchExportHistory('qa-room', loadPage);

    expect(loadPage).toHaveBeenCalledTimes(EXPORT_HISTORY_MAX_PAGES);
    expect(result.messages).toHaveLength(EXPORT_HISTORY_MAX_PAGES * EXPORT_HISTORY_PAGE_SIZE);
    expect(result.limited).toBe(true);
    expect(loadPage).toHaveBeenLastCalledWith('qa-room', EXPORT_HISTORY_MAX_PAGES, EXPORT_HISTORY_PAGE_SIZE);
  });

  it('stops at an empty terminal page and propagates API errors', async () => {
    const loadPage = jest.fn()
      .mockResolvedValueOnce({messages: [makeMessage(1)], hasMore: true})
      .mockResolvedValueOnce({messages: [], hasMore: false});

    const result = await fetchExportHistory('qa-room', loadPage);
    expect(result).toEqual({messages: [makeMessage(1)], limited: false});
    await expect(fetchExportHistory('qa-room', async () => { throw new Error('network failed'); }))
      .rejects.toThrow('network failed');
  });

  it('rejects a malformed history response', async () => {
    await expect(fetchExportHistory('qa-room', async () => ({messages: null as any})))
      .rejects.toThrow('Máy chủ trả về dữ liệu lịch sử không hợp lệ.');
  });
});
