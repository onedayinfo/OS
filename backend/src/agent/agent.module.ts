import { Module } from '@nestjs/common';
import { ContractGate } from './contract-gate.service.js';
import { AgentCodeService } from './agent-code.service.js';
import { ClientAgentController } from './client-agent.controller.js';
import { AgentService } from './agent.service.js';
import { AgentController } from './agent.controller.js';

@Module({
  providers: [ContractGate, AgentCodeService, AgentService],
  controllers: [ClientAgentController, AgentController],
  exports: [ContractGate, AgentCodeService],
})
export class AgentModule {}
