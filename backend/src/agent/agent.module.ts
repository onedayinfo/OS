import { Module } from '@nestjs/common';
import { ContractGate } from './contract-gate.service.js';
import { AgentCodeService } from './agent-code.service.js';
import { ClientAgentController } from './client-agent.controller.js';
import { AgentService } from './agent.service.js';
import { AgentController } from './agent.controller.js';
import { AgentDevicesController } from './agent-devices.controller.js';
import { AgentDevicesService } from './agent-devices.service.js';
import { ImprovementsController } from './improvements.controller.js';
import { AssetsModule } from '../assets/assets.module.js';

@Module({
  imports: [AssetsModule],
  providers: [ContractGate, AgentCodeService, AgentService, AgentDevicesService],
  controllers: [ClientAgentController, AgentController, AgentDevicesController, ImprovementsController],
  exports: [ContractGate, AgentCodeService],
})
export class AgentModule {}
