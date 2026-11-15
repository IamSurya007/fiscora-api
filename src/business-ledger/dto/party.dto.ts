import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { GSTIN_REGEX } from '../ledger';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;

export class CreatePartyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  name: string;

  /** Indian mobile; normalised server-side. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  phone?: string | null;

  @IsOptional()
  @Matches(GSTIN_REGEX, { message: 'gstin must be a valid 15-character GSTIN' })
  @Transform(upper)
  gstin?: string | null;
}

export class UpdatePartyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  phone?: string | null;

  @IsOptional()
  @Matches(GSTIN_REGEX, { message: 'gstin must be a valid 15-character GSTIN' })
  @Transform(upper)
  gstin?: string | null;
}
