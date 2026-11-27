import {getVisibleCachedRoomIds} from '../src/utils/chatRoomSync';

describe('getVisibleCachedRoomIds', () => {
  it('joins cached direct and group rooms, excluding hidden rooms and duplicates', () => {
    expect(getVisibleCachedRoomIds(
      {alice: 'direct-1', bob: 'direct-2', duplicate: 'group-1'},
      [{_id: 'group-1'}, {_id: 'group-2'}, {}],
      ['direct-2'],
    )).toEqual(['direct-1', 'group-1', 'group-2']);
  });

  it('ignores invalid and empty cached room IDs', () => {
    expect(getVisibleCachedRoomIds(
      {missing: undefined, nullish: null, empty: ''},
      [{_id: undefined}, {_id: null}],
      [],
    )).toEqual([]);
  });
});
