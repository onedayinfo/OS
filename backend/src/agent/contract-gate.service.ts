import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ContractGate {
  constructor(private readonly prisma: PrismaService) {}

  async hasValidContract(clientId: string, now = new Date()): Promise<boolean> {
    const n = await this.prisma.contract.count({
      where: { clientId, status: 'ACTIVE', endDate: { gte: now } },
    });
    return n > 0;
  }
}
