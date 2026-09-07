import { MulterError } from 'multer';
import { MulterExceptionFilter } from './multer-exception.filter.js';

function hostMock() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as any;
  return { res, host };
}

describe('MulterExceptionFilter', () => {
  it('LIMIT_FILE_SIZE → 413', () => {
    const { res, host } = hostMock();
    new MulterExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE'), host);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('outro MulterError → 400', () => {
    const { res, host } = hostMock();
    new MulterExceptionFilter().catch(new MulterError('LIMIT_UNEXPECTED_FILE'), host);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
