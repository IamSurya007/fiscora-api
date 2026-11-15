import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SplitLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  subcategoryId?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}
