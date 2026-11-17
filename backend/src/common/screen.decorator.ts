import { SetMetadata } from '@nestjs/common';
import type { ScreenKey } from '../user-groups/screens.js';

export const SCREEN_KEY = 'screen';

/** Exige que o grupo do usuário libere a tela `key` (método vence a classe). */
export const Screen = (key: ScreenKey) => SetMetadata(SCREEN_KEY, key);
/** Desliga a checagem de tela herdada da classe. */
export const SkipScreen = () => SetMetadata(SCREEN_KEY, null);
