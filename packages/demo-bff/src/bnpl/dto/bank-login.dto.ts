import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';

export const BANK_CONNECTION_METHODS = ['qr', 'device'] as const;
export type BankConnectionMethod = (typeof BANK_CONNECTION_METHODS)[number];

export class BankLoginDto {
  /** A persona id, which is also a file name: kept to a safe alphabet. */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+$/)
  persona: string;

  /** How the customer authenticated at the simulated bank. */
  @IsIn(BANK_CONNECTION_METHODS)
  method: BankConnectionMethod;
}
