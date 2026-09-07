import { isAbsolute } from 'node:path';
import { AttachmentsController } from './attachments.controller.js';

function makeRes() {
  const res: any = {
    type: vi.fn().mockReturnThis(),
    download: vi.fn((_path: string, _name: string, cb: (err?: Error) => void) => cb()),
  };
  return res;
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null } as any;

describe('AttachmentsController.download — nome de arquivo seguro', () => {
  it.each([
    ['relatório de rede.pdf', 'application/pdf'],
    ['x".pdf', 'application/pdf'],
  ])('baixa %j via res.download (encoding RFC 5987, sem spoof)', async (filename, mime) => {
    const attachments = {
      getForDownload: vi.fn().mockResolvedValue({
        filename,
        mime,
        storedPath: '/srv/uploads/abc.pdf',
      }),
    };
    const controller = new AttachmentsController(attachments as any);
    const res = makeRes();

    await controller.download('at1', actor, res);

    expect(res.type).toHaveBeenCalledWith(mime);
    const [path, name] = res.download.mock.calls[0];
    expect(isAbsolute(path)).toBe(true);
    // nome cru repassado ao Express, que faz o encoding/escape do header
    expect(name).toBe(filename);
  });
});
