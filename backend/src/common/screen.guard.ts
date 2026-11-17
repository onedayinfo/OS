import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ScreenKey } from '../user-groups/screens.js';
import { UserGroupsService } from '../user-groups/user-groups.service.js';
import { SCREEN_KEY } from './screen.decorator.js';

@Injectable()
export class ScreenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly groups: UserGroupsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const screen = this.reflector.getAllAndOverride<ScreenKey | null | undefined>(SCREEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!screen) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user) return true; // JwtAuthGuard/@Public já decidiram
    const allowed = await this.groups.screensFor(user.id);
    if (allowed === null || allowed.includes(screen)) return true;
    throw new ForbiddenException('Sem acesso a esta tela.');
  }
}
