import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Loan } from '../database/entities/loan.entity';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { LoanType, LoanStatus } from '../database/enums';
import { AddLoanRepaymentDto } from './dto/loan-repayment.dto';
import { nextDueRow, normalizeRepayments, outstanding, toDateOnly } from './emi';
import { randomUUID } from 'crypto';

/**
 * After the repayment log changes: fully repaid -> PAID; a PAID loan that
 * now has money outstanding (a repayment was removed) goes back to ACTIVE.
 */
export function statusAfterRepayments(loan: Loan): LoanStatus {
  const left = outstanding(loan);
  if (left <= 0) return LoanStatus.PAID;
  if (loan.status === LoanStatus.PAID) return LoanStatus.ACTIVE;
  return loan.status;
}

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
  ) {}

  async create(userId: string, dto: CreateLoanDto): Promise<Loan> {
    const loan = this.loansRepository.create({
      ...dto,
      userId,
      repaymentDate: dto.repaymentDate ? new Date(dto.repaymentDate) : null,
      isEmi: dto.isEmi ?? false,
      emiStartDate: dto.emiStartDate ? toDateOnly(dto.emiStartDate) : null,
      repayments: normalizeRepayments(dto.repayments),
    });
    if (loan.repayments?.length) loan.status = statusAfterRepayments(loan);
    return this.loansRepository.save(loan);
  }

  async findAll(userId: string, type?: LoanType, status?: LoanStatus): Promise<Loan[]> {
    const where: any = { userId, isDeleted: false };
    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    return this.loansRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Loan> {
    const loan = await this.loansRepository.findOne({ where: { id } });
    if (!loan) {
      throw new NotFoundException('Loan not found');
    }
    if (loan.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's loan");
    }
    return loan;
  }

  async update(userId: string, id: string, dto: UpdateLoanDto): Promise<Loan> {
    const loan = await this.findOne(userId, id);

    if (dto.type !== undefined) loan.type = dto.type;
    if (dto.name !== undefined) loan.name = dto.name;
    if (dto.principal !== undefined) loan.principal = dto.principal;
    if (dto.total !== undefined) loan.total = dto.total;
    if (dto.repaymentDate !== undefined) {
      loan.repaymentDate = dto.repaymentDate ? new Date(dto.repaymentDate) : null;
    }
    if (dto.status !== undefined) loan.status = dto.status;
    if (dto.notes !== undefined) loan.notes = dto.notes;
    if (dto.interestRate !== undefined) loan.interestRate = dto.interestRate;
    if (dto.isEmi !== undefined) loan.isEmi = dto.isEmi;
    if (dto.emiAmount !== undefined) loan.emiAmount = dto.emiAmount;
    if (dto.tenureMonths !== undefined) loan.tenureMonths = dto.tenureMonths;
    if (dto.emiStartDate !== undefined) {
      loan.emiStartDate = dto.emiStartDate ? toDateOnly(dto.emiStartDate) : null;
    }
    if (dto.emiDayOfMonth !== undefined) loan.emiDayOfMonth = dto.emiDayOfMonth;
    if (dto.repayments !== undefined) {
      loan.repayments = normalizeRepayments(dto.repayments);
      // An explicit status in the same request wins.
      if (dto.status === undefined) loan.status = statusAfterRepayments(loan);
    }
    // Bump the version so offline clients accept this edit on their next pull.
    loan.version = (loan.version || 1) + 1;

    return this.loansRepository.save(loan);
  }

  /** Appends one repayment to the loan's log and updates its status. */
  async addRepayment(userId: string, id: string, dto: AddLoanRepaymentDto): Promise<Loan> {
    const loan = await this.findOne(userId, id);
    loan.repayments = [
      ...normalizeRepayments(loan.repayments),
      ...normalizeRepayments([{ ...dto, id: dto.id || randomUUID() }]),
    ];
    loan.status = statusAfterRepayments(loan);
    loan.version = (loan.version || 1) + 1;
    return this.loansRepository.save(loan);
  }

  async remove(userId: string, id: string): Promise<void> {
    const loan = await this.findOne(userId, id);
    // Soft delete so the mobile app receives a tombstone on its next pull.
    loan.isDeleted = true;
    loan.version = (loan.version || 1) + 1;
    await this.loansRepository.save(loan);
  }

  async getSummary(userId: string) {
    const activeLoans = await this.loansRepository.find({
      where: {
        userId,
        isDeleted: false,
        status: Not(LoanStatus.PAID),
      },
    });

    let totalOwed = 0;
    let totalToReceive = 0;
    const upcomingRepayments: any[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const loan of activeLoans) {
      const left = Math.max(0, outstanding(loan));
      if (loan.type === LoanType.TAKEN) {
        totalOwed += left;
      } else if (loan.type === LoanType.GIVEN) {
        totalToReceive += left;
      }

      const nextEmi = loan.isEmi ? nextDueRow(loan) : null;
      if (nextEmi) {
        const due = new Date(`${nextEmi.dueDate}T00:00:00`);
        const daysRemaining = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        upcomingRepayments.push({
          id: loan.id,
          name: loan.name,
          total: nextEmi.emi,
          repaymentDate: nextEmi.dueDate,
          daysRemaining,
          type: loan.type,
        });
      } else if (loan.repaymentDate) {
        const repayment = new Date(loan.repaymentDate);
        repayment.setHours(0, 0, 0, 0);
        const diffTime = repayment.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        upcomingRepayments.push({
          id: loan.id,
          name: loan.name,
          total: loan.total,
          repaymentDate: loan.repaymentDate.toISOString().substring(0, 10),
          daysRemaining,
          type: loan.type,
        });
      }
    }

    // Sort upcoming repayments by date ascending (closest repayment date first)
    upcomingRepayments.sort((a, b) => new Date(a.repaymentDate).getTime() - new Date(b.repaymentDate).getTime());

    return {
      totalOwed,
      totalToReceive,
      netPosition: totalToReceive - totalOwed,
      upcomingRepayments: upcomingRepayments.slice(0, 5), // return top 5
    };
  }
}
