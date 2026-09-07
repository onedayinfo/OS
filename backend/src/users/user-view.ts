import type { User } from '@prisma/client';

/**
 * Allowlist de campos de User seguros para resposta de API.
 * Nunca inclui passwordHash, inviteToken nem inviteSentAt.
 */
export function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    type: u.type,
    role: u.role,
    clientId: u.clientId,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export function publicUsers(list: User[]) {
  return list.map(publicUser);
}
