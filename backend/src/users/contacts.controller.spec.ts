import { ContactsController } from './users.controller.js';

describe('GET /api/clients/:clientId/contacts', () => {
  it('delega para users.findAll com type CLIENT + clientId', async () => {
    const users = { findAll: vi.fn().mockResolvedValue([{ id: 'u1' }]) };
    const controller = new ContactsController(users as any);

    const result = await controller.findAll('cli1');

    expect(users.findAll).toHaveBeenCalledWith({ type: 'CLIENT', clientId: 'cli1' });
    expect(result).toEqual([{ id: 'u1' }]);
  });
});
