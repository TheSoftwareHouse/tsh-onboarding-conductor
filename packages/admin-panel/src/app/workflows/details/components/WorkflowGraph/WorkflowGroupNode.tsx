import type { ReactElement } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { STEP_CATEGORY_TONES } from '../../constants/step-category-tones';
import type { WorkflowGroupNode as WorkflowGroupNodeType } from '../../utils/workflow-graph-layout';

/** The frame around the compiled steps one authored step produced, labelled with that step. */
export function WorkflowGroupNode({ data }: NodeProps<WorkflowGroupNodeType>): ReactElement {
  return (
    <div
      className={cn(
        'pointer-events-none border border-dashed',
        STEP_CATEGORY_TONES[data.category]?.frame ?? 'border-tsh-gray-500',
      )}
      style={{ width: data.width, height: data.height }}
    >
      <Typography variant="meta" className="truncate px-2 py-1 text-body-2xs" title={data.step}>
        {data.step} · {data.type}
      </Typography>
    </div>
  );
}
