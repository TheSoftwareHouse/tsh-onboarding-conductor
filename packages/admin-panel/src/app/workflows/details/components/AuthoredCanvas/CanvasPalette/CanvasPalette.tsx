import { useState, type ReactElement } from 'react';
import { listStepTypes, STEP_CATEGORIES } from '@tsh/ddl-schema/step-types';
import { Button } from '@/components/ui/Button/Button';
import { LeftPanelClose, LeftPanelOpen } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { STEP_CATEGORY_TONES } from '../../../constants/step-category-tones';
import { findStepTypeDescription } from '../../../constants/step-type-descriptions';
import { usePaletteOpen } from './usePaletteOpen';

export interface CanvasPaletteProps {
  onAdd: (type: string) => void;
  onDragStart: (type: string) => void;
  onDragEnd: () => void;
}

/** Matched against the type and its description, so "sms" finds `otp-verify` and `notify`. */
function matchesQuery(type: string, query: string): boolean {
  return (
    type.includes(query) || (findStepTypeDescription(type) ?? '').toLowerCase().includes(query)
  );
}

/** Every registered step type, grouped by category, to click or drag onto the canvas. */
export function CanvasPalette({ onAdd, onDragStart, onDragEnd }: CanvasPaletteProps): ReactElement {
  const [open, togglePalette] = usePaletteOpen();
  const [query, setQuery] = useState('');

  if (!open) {
    return (
      <aside className="flex shrink-0 flex-col items-center border-r border-border-rule py-3">
        <Button
          variant="quiet"
          size="sm"
          className="px-2"
          aria-label="Show step palette"
          title="Show step palette"
          onClick={togglePalette}
        >
          <LeftPanelOpen aria-hidden className="size-6" />
        </Button>
      </aside>
    );
  }

  const needle = query.trim().toLowerCase();
  const stepTypes = listStepTypes().filter(({ type }) => matchesQuery(type, needle));

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border-rule p-3">
      <div className="flex items-center justify-between gap-2">
        <Typography variant="caps-tiny">Add step</Typography>
        <Button
          variant="quiet"
          size="sm"
          className="px-1"
          aria-label="Hide step palette"
          title="Hide step palette"
          onClick={togglePalette}
        >
          <LeftPanelClose aria-hidden className="size-6" />
        </Button>
      </div>
      <Input
        type="search"
        size="sm"
        className="h-8"
        aria-label="Search step types"
        placeholder="Search steps"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // Enter adds the first match, so a step can be added without the mouse.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && stepTypes.length > 0) onAdd(stepTypes[0]!.type);
        }}
      />
      <Typography variant="meta" className="leading-natural">
        Click or drag onto the canvas to add a step. Drop a type tagged section onto a step to
        include it there.
      </Typography>
      {stepTypes.length === 0 && <Typography variant="meta">No step type matches.</Typography>}
      {STEP_CATEGORIES.filter((category) =>
        stepTypes.some((type) => type.category === category),
      ).map((category) => (
        // One bar down the whole category, heading included, flush with the palette's left edge.
        <div
          key={category}
          className={cn('-ml-3 flex flex-col border-l-8', STEP_CATEGORY_TONES[category].accent)}
        >
          <Typography variant="meta" className="px-3 pb-1">
            {category}
          </Typography>
          {stepTypes
            .filter((type) => type.category === category)
            .map((type) => (
              // A draggable two-line card has no ui equivalent.
              <button
                key={type.type}
                type="button"
                className="flex cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-bg-subtle"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', type.type);
                  event.dataTransfer.effectAllowed = 'copy';
                  onDragStart(type.type);
                }}
                onDragEnd={onDragEnd}
                onClick={() => onAdd(type.type)}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <Typography variant="mono" as="span" className="text-fg-1">
                    {type.type}
                  </Typography>
                  {type.composable === true && (
                    <Typography
                      variant="meta"
                      as="span"
                      className="border border-border-strong px-1 text-fg-3"
                      title="Can also be dropped onto a step, to include it as a section"
                    >
                      section
                    </Typography>
                  )}
                </span>
                <Typography variant="meta" as="span" className="leading-natural">
                  {findStepTypeDescription(type.type)}
                </Typography>
              </button>
            ))}
        </div>
      ))}
    </aside>
  );
}
