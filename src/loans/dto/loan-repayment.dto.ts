import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoanRepaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id: string;

  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string | null;
}

/** Body of POST /loans/:id/repayments (the server assigns the id when omitted). */
export class AddLoanRepaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;
}
