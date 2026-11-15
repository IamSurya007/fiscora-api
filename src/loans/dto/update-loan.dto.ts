import { IsEnum, IsNumber, IsOptional, IsString, Min, IsDateString, IsBoolean, IsInt, Max, IsArray, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LoanRepaymentDto } from './loan-repayment.dto';
import { LoanType, LoanStatus } from '../../database/enums';

export class UpdateLoanDto {
  @IsOptional()
  @IsEnum(LoanType)
  type?: LoanType;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  principal?: number;

  /** Annual interest rate in percent. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  total?: number;

  @IsOptional()
  @IsDateString()
  repaymentDate?: string;

  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

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
