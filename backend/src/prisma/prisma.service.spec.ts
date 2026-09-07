import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service.js';

// Injeção por tipo no construtor: só resolve se emitDecoratorMetadata for
// emitido (swc no vitest.config). Guarda de regressão do setup de DI.
class FakeConsumer {
  constructor(private prisma: PrismaService) {}
}

describe('PrismaService (DI)', () => {
  it('resolve PrismaService injetado por tipo no construtor', async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, FakeConsumer],
    }).compile();

    expect(module.get(FakeConsumer)).toBeDefined();
  });
});
