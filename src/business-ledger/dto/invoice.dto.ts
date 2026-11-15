import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { STATE_CODE_REGEX } from '../ledger';

export class InvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description: string;

  @IsOptional()
  @Matches(/^[0-9]{4,8}$/, { message: 'hsnSac must be 4-8 digits' })
  hsnSac?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qty: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate: number;

  @IsOptional()
  @IsIn([0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40])
  gstRate?: number;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  partyId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  /** 2-digit GST state code; only for GST-registered sellers. */
  @IsOptional()
  @Matches(STATE_CODE_REGEX, { message: 'placeOfSupply must be a 2-digit state code' })
  placeOfSupply?: string;

  @IsOptional()
  @IsIn(['draft', 'sent'])
  status?: 'draft' | 'sent';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  notes?: string;
}

export class UpdateInvoiceStatusDto {
  @IsIn(['draft', 'sent', 'paid'])
  status: 'draft' | 'sent' | 'paid';

  /** Payment date when marking paid; defaults to today. */
  @IsOptional()
  @IsDateString()
  paidOn?: string;
}

export class BusinessProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  businessName?: string | null;

  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  gstin?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;
}
