export function getVisibleCachedRoomIds(
  directRoomIds: Record<string, unknown>,
  groupRooms: Array<{_id?: unknown}>,
  hiddenRoomIds: Array<string | number>,
): string[] {
  const hidden = new Set(hiddenRoomIds.map(String));
  const candidates = [
    ...Object.values(directRoomIds),
    ...groupRooms.map(room => room?._id),
  ];

  return Array.from(new Set(candidates
    .filter(value => value !== undefined && value !== null)
    .map(String)
    .filter(roomId => roomId.length > 0 && !hidden.has(roomId))));
}
