import { Readable, Writable } from 'node:stream';
import { AttachmentsController } from './attachments.controller.js';

function makeRes() {
  const res = new Writable({ write(_c, _e, cb) { cb(); } }) as any;
  res.type = vi.fn().mockReturnThis();
  res.setHeader = vi.fn();
  return res;
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null } as any;

describe('AttachmentsController.download — nome de arquivo seguro', () => {
  it.each([
    ['relatório de rede.pdf', 'application/pdf'],
    ['x".pdf', 'application/pdf'],
  ])('faz stream de %j com Content-Disposition RFC 5987 (sem spoof)', async (filename, mime) => {
    const attachments = {
      getForDownload: vi.fn().mockResolvedValue({ filename, mime, storedPath: 'attachments/abc.pdf' }),
      readable: vi.fn().mockResolvedValue({ stream: Readable.from([Buffer.from('pdf')]) }),
    };
    const controller = new AttachmentsController(attachments as any);
    const res = makeRes();

    await controller.download('at1', actor, res);

    expect(res.type).toHaveBeenCalledWith(mime);
    const [, header] = res.setHeader.mock.calls.find((c: string[]) => c[0] === 'Content-Disposition')!;
    // aspas e caracteres não-ASCII não vazam pro nome ASCII
    expect(header).not.toMatch(/filename="[^"]*["\\][^"]*"/);
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(filename)}`);
  });

  it('objeto ausente no armazenamento → 404', async () => {
    const attachments = {
      getForDownload: vi.fn().mockResolvedValue({ filename: 'a.pdf', mime: 'application/pdf', storedPath: 'attachments/x.pdf' }),
      readable: vi.fn().mockRejectedValue(new Error('ENOENT')),
    };
    const controller = new AttachmentsController(attachments as any);
    await expect(controller.download('at1', actor, makeRes())).rejects.toThrow(/não encontrado/i);
  });
});
