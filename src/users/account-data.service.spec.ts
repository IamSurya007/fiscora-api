import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { AccountDataService } from './account-data.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { User } from '../database/entities/user.entity';
import { Account } from '../database/entities/account.entity';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Category } from '../database/entities/category.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';
import { ChatConversation } from '../database/entities/chat-conversation.entity';
import { ChatMessage } from '../database/entities/chat-message.entity';

const ENTITIES = [Account, Expense, Budget, Loan, Investment, Category, CategoryRule, ChatConversation, ChatMessage];

const mockRepository = () => ({
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
});

describe('AccountDataService', () => {
  let service: AccountDataService;
  let repos: Map<unknown, any>;
  let userRepo: any;
  let firebase: { deleteUser: jest.Mock };
  let manager: { delete: jest.Mock };
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    manager = {
      delete: jest.fn(async (entity: any) => {
        calls.push(`delete:${entity.name}`);
      }),
    };
    firebase = {
      deleteUser: jest.fn(async () => {
        calls.push('firebase');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) => {
        calls.push('begin');
        await cb(manager);
        calls.push('commit');
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDataService,
        { provide: getRepositoryToken(User), useFactory: mockRepository },
        ...ENTITIES.map((e) => ({ provide: getRepositoryToken(e), useFactory: mockRepository })),
        { provide: DataSource, useValue: dataSource },
        { provide: FirebaseAdminService, useValue: firebase },
      ],
    }).compile();

    service = module.get(AccountDataService);
    userRepo = module.get(getRepositoryToken(User));
    repos = new Map(ENTITIES.map((e) => [e, module.get(getRepositoryToken(e))]));
  });

  describe('export', () => {
    it('scopes every query to the authenticated user and strips secrets', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        name: 'A',
        fcmToken: 'secret-fcm',
        sheetsToken: 'secret-sheets',
      });
      repos.get(Expense).find.mockResolvedValue([{ id: 'e1', userId: 'user-1', isDeleted: true }]);
      repos.get(ChatConversation).find.mockResolvedValue([{ id: 'c1', userId: 'user-1' }]);
      repos.get(ChatMessage).find.mockResolvedValue([
        { id: 'm1', conversationId: 'c1', userId: 'user-1' },
        { id: 'm2', conversationId: 'c-other', userId: 'user-1' },
      ]);

      const result: any = await service.export('user-1');

      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      for (const entity of ENTITIES) {
        const repo = repos.get(entity);
        expect(repo.find).toHaveBeenCalledTimes(1);
        expect(repo.find).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      }
      expect(result.profile).toEqual({ id: 'user-1', email: 'a@b.com', name: 'A' });
      expect(JSON.stringify(result)).not.toContain('secret-');
      expect(result.expenses).toEqual([{ id: 'e1', userId: 'user-1', isDeleted: true }]);
      expect(result.chatConversations[0].messages.map((m: any) => m.id)).toEqual(['m1']);
    });

    it('throws when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.export('ghost')).rejects.toThrow('User not found');
    });
  });

  describe('deleteAll', () => {
    it('deletes children before parents in one transaction, then the Firebase user', async () => {
      await service.deleteAll('user-1');

      expect(calls).toEqual([
        'begin',
        'delete:ChatMessage',
        'delete:ChatConversation',
        'delete:Expense',
        'delete:Budget',
        'delete:Loan',
        'delete:Investment',
        'delete:CategoryRule',
        'delete:Category',
        'delete:Account',
        'delete:User',
        'commit',
        'firebase',
      ]);
      for (const [entity, criteria] of manager.delete.mock.calls) {
        expect(criteria).toEqual(entity === User ? { id: 'user-1' } : { userId: 'user-1' });
      }
      expect(firebase.deleteUser).toHaveBeenCalledWith('user-1');
    });

    it('does not touch Firebase when the database delete fails', async () => {
      manager.delete.mockRejectedValueOnce(new Error('db down'));
      await expect(service.deleteAll('user-1')).rejects.toThrow('db down');
      expect(firebase.deleteUser).not.toHaveBeenCalled();
    });

    it('reports a retryable error when Firebase removal fails', async () => {
      firebase.deleteUser.mockRejectedValueOnce(new Error('network'));
      await expect(service.deleteAll('user-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
