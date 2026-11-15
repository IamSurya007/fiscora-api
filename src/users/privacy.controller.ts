import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';

/** Public privacy information (DPDP grievance officer contact). */
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get('contact')
  getContact() {
    return {
      grievanceOfficer: {
        name: this.config.get<string>('GRIEVANCE_NAME') ?? null,
        email: this.config.get<string>('GRIEVANCE_EMAIL') ?? null,
      },
    };
  }
}
