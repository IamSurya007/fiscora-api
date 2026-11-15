import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, IsInt, Max, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { AccountType } from '../../database/enums';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType | string;

  @IsOptional()
  @IsNumber()
  currentBalance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  accountNumberLast4?: string;

  @IsOptional()
  @IsNumber()
  colorValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  statementDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  /** 'personal' (default), 'business' or 'mixed'. */
  @IsOptional()
  @IsIn(['personal', 'business', 'mixed'])
  ownership?: 'personal' | 'business' | 'mixed';
}
