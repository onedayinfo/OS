import { normalizeSerial } from './serial.util.js';
import { matchDevice } from './match-device.util.js';

describe('normalizeSerial', () => {
  it.each(['To be filled by O.E.M.', '  ', '0000000', 'None', '', null, undefined, 'N/A', '0'])(
    '%j -> null',
    (v) => expect(normalizeSerial(v as any)).toBeNull(),
  );
  it('apara', () => expect(normalizeSerial(' ABC123 ')).toBe('ABC123'));
});

describe('matchDevice', () => {
  it('new', () => expect(matchDevice([], 'X')).toEqual({ kind: 'new' }));
  it('match', () => expect(matchDevice([{ id: '1', serialKey: 'X' }], 'X')).toEqual({ kind: 'match', id: '1' }));
  it('clone', () => expect(matchDevice([{ id: '1', serialKey: 'X' }], 'Y')).toEqual({ kind: 'clone' }));
  it('adopt', () => expect(matchDevice([{ id: '1', serialKey: '' }], 'Y')).toEqual({ kind: 'adopt', id: '1' }));
  it('sem serial usa o existente', () =>
    expect(matchDevice([{ id: '1', serialKey: 'X' }], '')).toEqual({ kind: 'match', id: '1' }));
});
