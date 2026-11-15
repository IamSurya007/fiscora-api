import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, IsDateString, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentMethod, ExpenseSource } from '../../database/enums';

export class UpdateExpenseDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  /** Money coming in (income, refund). `amount` stays positive; it is stored negated. */
  @IsOptional()
  @IsBoolean()
  isCredit?: boolean;

  /** false once the user has confirmed an auto-captured transaction. */
  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;

  /** Set for a transfer between the user's own accounts: the account receiving the money. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  transferAccountId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  subcategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  subcategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsEnum(ExpenseSource)
  source?: ExpenseSource;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  merchant?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  accountId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value, obj }) => {
    if (value !== undefined) return Boolean(value);
    if (obj && obj.is_counted_as_spend !== undefined) return Boolean(obj.is_counted_as_spend);
    return undefined;
  })
  isCountedAsSpend?: boolean;

  /** 'personal' (default) or 'business'. */
  @IsOptional()
  @IsIn(['personal', 'business'])
  scope?: 'personal' | 'business';

  /** TDS the payer deducted on this business receipt, in rupees (optional). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  tdsAmount?: number | null;
}
