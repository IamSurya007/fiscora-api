import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const logger = new Logger('CronLock');

/**
 * Runs [job] only if no other API instance is running the same job.
 * Postgres advisory locks belong to one connection, so the lock is taken and
 * released on a dedicated query runner (taking it through the pool could
 * unlock on a different connection and leave it held forever).
 */
export async function withCronLock(dataSource: DataSource, name: string, job: () => Promise<void>): Promise<void> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`cron:${name}`]);
    if (!locked) {
      logger.log(`${name}: already running on another instance, skipping`);
      return;
    }
    try {
      await job();
    } finally {
      await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [`cron:${name}`]);
    }
  } finally {
    await runner.release();
  }
}
