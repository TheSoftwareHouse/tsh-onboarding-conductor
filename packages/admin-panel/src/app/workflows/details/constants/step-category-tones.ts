import type { WorkflowStepCategory } from '@tsh/ddl-schema/step-types';

/** Per step-type category: a left accent as a border (`accent`) or an overlay (`bar`), and a group frame's border. */
export const STEP_CATEGORY_TONES: Record<
  WorkflowStepCategory,
  { bar: string; accent: string; frame: string }
> = {
  collect: {
    bar: 'bg-tsh-blue-500',
    accent: 'border-l-tsh-blue-500',
    frame: 'border-tsh-blue-500',
  },
  verify: {
    bar: 'bg-tsh-purple-500',
    accent: 'border-l-tsh-purple-500',
    frame: 'border-tsh-purple-500',
  },
  decide: {
    bar: 'bg-tsh-yellow-500',
    accent: 'border-l-tsh-yellow-500',
    frame: 'border-tsh-yellow-500',
  },
  integrate: { bar: 'bg-tsh-teal', accent: 'border-l-tsh-teal', frame: 'border-tsh-teal' },
  terminal: {
    bar: 'bg-tsh-gray-500',
    accent: 'border-l-tsh-gray-500',
    frame: 'border-tsh-gray-500',
  },
};

/** The tones of a category, or `undefined` for a category the panel does not know. */
export function findStepCategoryTone(
  category: string,
): (typeof STEP_CATEGORY_TONES)[WorkflowStepCategory] | undefined {
  return Object.hasOwn(STEP_CATEGORY_TONES, category)
    ? STEP_CATEGORY_TONES[category as WorkflowStepCategory]
    : undefined;
}
