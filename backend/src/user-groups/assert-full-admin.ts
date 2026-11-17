import { ForbiddenException } from '@nestjs/common';
import type { UserGroupsService } from './user-groups.service.js';

/** Só o admin pleno (ADMIN sem grupo) passa; senão 403. */
export async function assertFullAdmin(groups: UserGroupsService, actorId: string): Promise<void> {
  if (!(await groups.isFullAdmin(actorId))) {
    throw new ForbiddenException('Sem acesso a esta tela.');
  }
}
