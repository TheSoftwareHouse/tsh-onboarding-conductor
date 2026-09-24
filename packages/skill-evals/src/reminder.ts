import { resolve } from 'node:path';

/** One skill with uncommitted changes, and the exact content those changes are at. */
export type SkillChanges = {
  readonly skills: readonly string[];
  /** Absent when no skill changed; otherwise a digest of the changed files' content. */
  readonly fingerprint?: string;
};

export type StopDecision = {
  readonly block: boolean;
  readonly fingerprint?: string;
  readonly reason?: string;
};

type ReminderModule = {
  collectSkillChanges(root?: string): SkillChanges;
  parsePorcelain(stdout: string): { status: string; path: string }[];
  reminder(skills: readonly string[]): string;
  skillOf(path: string): string | undefined;
  skillsForPaths(paths: readonly unknown[]): string[];
  stopDecision(options: {
    changes: SkillChanges;
    previousFingerprint?: string;
    stopHookActive?: boolean;
  }): StopDecision;
};

// The hook stays a CommonJS script under `scripts/`: Claude Code runs it per tool call and per
// stop, where a ts-node boot would be felt. Requiring it runs nothing.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const reminderScript = require(
  resolve(__dirname, '..', '..', '..', 'scripts', 'skill-evals-reminder.cjs'),
) as ReminderModule;

export const collectSkillChanges = reminderScript.collectSkillChanges;
export const parsePorcelain = reminderScript.parsePorcelain;
export const reminder = reminderScript.reminder;
export const skillOf = reminderScript.skillOf;
export const skillsForPaths = reminderScript.skillsForPaths;
export const stopDecision = reminderScript.stopDecision;
