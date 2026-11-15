import { ValueTransformer } from 'typeorm';

/** numeric columns come back from pg as strings; expose them as numbers. */
export const moneyTransformer: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null || v === undefined ? v : Number(v)),
};
