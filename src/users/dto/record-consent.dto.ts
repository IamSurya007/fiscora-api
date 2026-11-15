import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RecordConsentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  version: string;

  /** 18+ self-declaration. */
  @IsBoolean()
  isAdult: boolean;
}
