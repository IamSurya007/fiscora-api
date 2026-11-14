import { Controller, Get, Put, Patch, Body, Param, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { UpsertBudgetDto, UpdateBudgetLimitDto } from './dto/upsert-budget.dto';
import { CurrentUser } from '../auth/current-user.decorator';

/** Budgets live under a calendar month ("YYYY-MM") or "all" (every month). */
function budgetMonth(month: string): string {
  if (month !== 'all' && !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException('Month must be "all" or YYYY-MM');
  }
  return month;
}

@ApiBearerAuth('bearer')
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get(':month/status')
  async getStatus(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
  ) {
    return this.budgetsService.getStatus(userId, month);
  }

  @Get(':month')
  async findAll(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
  ) {
    return this.budgetsService.findAll(userId, budgetMonth(month));
  }

  @Put(':month')
  async upsertMany(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
    @Body() dto: UpsertBudgetDto,
  ) {
    return this.budgetsService.upsertMany(userId, budgetMonth(month), dto);
  }

  @Patch(':month/:category')
  async updateCategoryLimit(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
    @Param('category') category: string,
    @Body() dto: UpdateBudgetLimitDto,
  ) {
    return this.budgetsService.updateCategoryLimit(userId, budgetMonth(month), category, dto.limit);
  }
}
