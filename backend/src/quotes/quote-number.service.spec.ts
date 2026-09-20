import { QuoteNumberService } from './quote-number.service.js';

describe('QuoteNumberService', () => {
  it('incrementa o contador do ano e devolve o valor', async () => {
    const tx = {
      quoteCounter: {
        upsert: vi.fn().mockResolvedValue({ year: 2026, value: 1 }),
      },
    };
    const service = new QuoteNumberService();
    const number = await service.next(tx as any, 2026);
    expect(number).toBe(1);
    expect(tx.quoteCounter.upsert).toHaveBeenCalledWith({
      where: { year: 2026 },
      create: { year: 2026, value: 1 },
      update: { value: { increment: 1 } },
    });
  });
});
