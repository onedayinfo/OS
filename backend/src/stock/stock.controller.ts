import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { StockService } from './stock.service.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto.js';
import { UpdateStockBalanceDto } from './dto/update-stock-balance.dto.js';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto.js';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto.js';

@Controller()
@Roles('ADMIN', 'AGENT')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('warehouses')
  listWarehouses() {
    return this.stock.listWarehouses();
  }

  @Post('warehouses')
  @Roles('ADMIN')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.stock.createWarehouse(dto);
  }

  @Patch('warehouses/:id')
  @Roles('ADMIN')
  updateWarehouse(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.stock.updateWarehouse(id, dto);
  }

  @Get('stock/balances')
  listBalances(@Query() query: ListStockBalancesDto) {
    return this.stock.listBalances(query);
  }

  @Patch('stock/balances/:catalogItemId/:warehouseId')
  @Roles('ADMIN')
  updateMinQuantity(
    @Param('catalogItemId') catalogItemId: string,
    @Param('warehouseId') warehouseId: string,
    @Body() dto: UpdateStockBalanceDto,
  ) {
    return this.stock.updateMinQuantity(catalogItemId, warehouseId, dto.minQuantity);
  }

  @Post('stock/entries')
  createEntry(@Body() dto: CreateStockEntryDto, @CurrentUser() actor: CurrentUserData) {
    return this.stock.createEntry(dto, actor.id);
  }

  @Post('stock/transfers')
  createTransfer(@Body() dto: CreateStockTransferDto, @CurrentUser() actor: CurrentUserData) {
    return this.stock.createTransfer(dto, actor.id);
  }
}
