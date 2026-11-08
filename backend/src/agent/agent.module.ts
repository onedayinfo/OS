import { Module } from '@nestjs/common';
import { ContractGate } from './contract-gate.service.js';
import { AgentCodeService } from './agent-code.service.js';
import { ClientAgentController } from './client-agent.controller.js';

@Module({
  providers: [ContractGate, AgentCodeService],
  controllers: [ClientAgentController],
  exports: [ContractGate, AgentCodeService],
})
export class AgentModule {}
