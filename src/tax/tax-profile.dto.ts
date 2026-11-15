import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateTaxProfileDto {
  @IsOptional()
  @IsIn(['44ADA', '44AD', 'regular'])
  regime?: '44ADA' | '44AD' | 'regular';

  @IsOptional()
  @IsIn(['services', 'goods'])
  businessType?: 'services' | 'goods';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  setAsidePercent?: number;

  @IsOptional()
  @IsBoolean()
  gstRegistered?: boolean;
}
