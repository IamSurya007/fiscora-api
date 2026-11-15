import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SingleBudgetDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsNumber()
  @Min(0)
  limit: number;

  @IsOptional()
  @IsBoolean()
  rollover?: boolean;
}

export class UpsertBudgetDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleBudgetDto)
  budgets: SingleBudgetDto[];
}

export class UpdateBudgetLimitDto {
  @IsNumber()
  @Min(0)
  limit: number;
}
