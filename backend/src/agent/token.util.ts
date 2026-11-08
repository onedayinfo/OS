import { createHash, randomBytes } from 'node:crypto';

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}
