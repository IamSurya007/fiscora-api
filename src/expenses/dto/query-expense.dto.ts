import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, IsInt, Min, Max, ValidateIf, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ExpenseSource } from '../../database/enums';

export class QueryExpenseDto {
  /** Required unless `q` is given (a search spans all months). */
  @ValidateIf((o) => !o.q)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be in YYYY-MM format' })
  month: string;

  /** Free-text search over merchant, note and category, or an exact amount. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Legacy: exact category name. */
  @IsOptional()
  @IsString()
  category?: string;

  /** Category or subcategory id; matches either level. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ExpenseSource)
  source?: ExpenseSource;

  /** true: only auto-captured transactions still waiting for review. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  needsReview?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  cursor?: string;
}
