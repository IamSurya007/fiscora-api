import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectSheetsDto {
  @IsString()
  @IsNotEmpty()
  sheetsId: string;

  @IsString()
  @IsNotEmpty()
  sheetsToken: string; // Google OAuth refresh token
}

export class ExchangeSheetsCodeDto {
  @IsString()
  @IsNotEmpty()
  sheetsId: string;

  @IsString()
  @IsNotEmpty()
  code: string; // Google OAuth authorization code from the redirect

  @IsString()
  @IsNotEmpty()
  redirectUri: string; // must match the authorize request and SHEETS_OAUTH_REDIRECT_URIS
}
