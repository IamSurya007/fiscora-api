import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsDateString, IsBoolean, IsInt, Max, IsArray, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LoanRepaymentDto } from './loan-repayment.dto';
import { LoanType } from '../../database/enums';

export class CreateLoanDto {
  @IsEnum(LoanType)
  type: LoanType;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name: string;

  @IsNumber()
  @Min(0.01)
  principal: number;

  @IsNumber()
  @Min(0.01)
  total: number;

  /** Annual interest rate in percent. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;

  @IsOptional()
  @IsDateString()
  repaymentDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  notes?: string;
  @IsOptional()
  @IsBoolean()
  isEmi?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emiAmount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  tenureMonths?: number | null;

  @IsOptional()
  @IsDateString()
  emiStartDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  emiDayOfMonth?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanRepaymentDto)
  repayments?: LoanRepaymentDto[];
}
