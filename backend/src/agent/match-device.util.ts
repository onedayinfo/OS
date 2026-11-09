export type MatchResult = { kind: 'match' | 'adopt'; id: string } | { kind: 'clone' | 'new' };

/** `existing`: dispositivos do mesmo cliente + machineGuid. */
export function matchDevice(
  existing: { id: string; serialKey: string }[],
  serialKey: string,
): MatchResult {
  if (existing.length === 0) return { kind: 'new' };
  const same = existing.find((d) => d.serialKey === serialKey);
  if (same) return { kind: 'match', id: same.id };
  if (serialKey === '') {
    const withSerial = existing.find((d) => d.serialKey !== '');
    if (withSerial) return { kind: 'match', id: withSerial.id };
  } else {
    const blank = existing.find((d) => d.serialKey === '');
    if (blank) return { kind: 'adopt', id: blank.id };
  }
  return { kind: 'clone' };
}
