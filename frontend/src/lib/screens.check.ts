import assert from 'node:assert/strict';
// @ts-expect-error — extensão .ts é exigida pelo node --experimental-strip-types; o tsc do build não aceita
import { canSee, screenForPath } from './screens.ts';

assert.equal(screenForPath('/app/crm/abc'), 'crm');
assert.equal(screenForPath('/app/crm'), 'crm');
assert.equal(screenForPath('/app/base-conhecimento/x'), 'base-conhecimento');
assert.equal(screenForPath('/app/chamados/1'), null);
assert.equal(screenForPath('/app'), null);
assert.equal(screenForPath('/app/crmx'), null);
assert.equal(canSee({ screens: null }, 'crm'), true);
assert.equal(canSee(null, 'crm'), true);
assert.equal(canSee({ screens: ['clientes'] }, 'crm'), false);
assert.equal(canSee({ screens: ['clientes'] }, 'clientes'), true);
