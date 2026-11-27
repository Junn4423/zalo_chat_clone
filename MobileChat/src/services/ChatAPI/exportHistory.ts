import {ExportableChatMessage, getChatHistoryPage} from './api';

export const EXPORT_HISTORY_PAGE_SIZE = 100;
export const EXPORT_HISTORY_MAX_PAGES = 20;

export type ExportHistoryPageLoader = (
  roomId: string,
  page: number,
  limit: number,
) => Promise<{messages: ExportableChatMessage[]; hasMore?: boolean}>;

export async function fetchExportHistory(
  roomId: string,
  loadPage: ExportHistoryPageLoader = getChatHistoryPage,
  pageSize = EXPORT_HISTORY_PAGE_SIZE,
  maxPages = EXPORT_HISTORY_MAX_PAGES,
) {
  const messages: ExportableChatMessage[] = [];
  let hasMore = true;
  let page = 1;

  while (hasMore && page <= maxPages) {
    const result = await loadPage(roomId, page, pageSize);
    if (!result || !Array.isArray(result.messages)) {
      throw new Error('Máy chủ trả về dữ liệu lịch sử không hợp lệ.');
    }
    messages.push(...result.messages);
    hasMore = Boolean(result.hasMore);
    page += 1;
  }

  return {messages, limited: hasMore};
}
