import { z } from 'zod';

export const accountSelectionSchema = z.object({
  selectedAccounts: z.array(z.string()).min(1, 'Select at least one account'),
});

export type AccountSelectionValues = z.infer<typeof accountSelectionSchema>;

/** The BFF's field codes for `selectedAccounts`, in words. */
const CODE_MESSAGES: Record<string, string> = {
  CHECKING_ACCOUNT_REQUIRED: 'Select your current account: the analysis needs it.',
};

export function selectionMessage(codes: readonly string[]): string {
  return codes.map((code) => CODE_MESSAGES[code] ?? code).join(' ');
}

/** `ids` with `id` added or removed. */
export function toggle(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((existing) => existing !== id);

  return on ? [...rest, id] : rest;
}
