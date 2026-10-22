// PoC (throwaway): a country declaration — a named preset, or an explicit list — as two dropdowns:
// where the countries come from, and for a custom list, which ones.
import { useMemo, useState, type ReactElement } from 'react';
import { Popover } from '@base-ui/react/popover';
import { COUNTRY_PRESETS } from '@tsh/ddl-schema/step-types/presets/country.preset';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { resolveSchema, type Schema } from './schema-utils';

const ALPHA_2 = '^[A-Z]{2}$';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PREVIEW_COUNT = 3;

const PRESET_LABELS: Record<string, string> = {
  eea: 'EEA',
  'eea-id-card-issuers': 'EEA ID-card issuers',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function nameCountry(code: string): string {
  return regionNames.of(code) ?? code;
}

function labelPreset(name: string): string {
  return PRESET_LABELS[name] ?? name;
}

/** Every alpha-2 code the browser can name, sorted by name. */
function listCountries(): { code: string; name: string }[] {
  const countries: { code: string; name: string }[] = [];
  for (const first of ALPHABET) {
    for (const second of ALPHABET) {
      const code = first + second;
      const name = regionNames.of(code);
      if (name && name !== code && !name.startsWith('Unknown')) countries.push({ code, name });
    }
  }
  return countries.sort((a, b) => a.name.localeCompare(b.name));
}

function isAlpha2List(schema: Schema): boolean {
  const resolved = resolveSchema(schema);
  return resolved.type === 'array' && resolveSchema(resolved.items ?? {}).pattern === ALPHA_2;
}

/** A plain list of alpha-2 codes, or `anyOf` a preset name and such a list. */
export function isCountrySchema(schema: Schema): boolean {
  const resolved = resolveSchema(schema);
  if (isAlpha2List(resolved)) return true;
  const variants = (resolved.anyOf ?? []).map(resolveSchema);
  return (
    variants.length === 2 && variants.some((variant) => variant.enum) && variants.some(isAlpha2List)
  );
}

function readPresetNames(schema: Schema): string[] {
  const presets = (resolveSchema(schema).anyOf ?? [])
    .map(resolveSchema)
    .find((variant) => variant.enum);
  return (presets?.enum ?? []).filter((name): name is string => typeof name === 'string');
}

function readPreset(name: string): readonly string[] {
  return (COUNTRY_PRESETS as Record<string, readonly string[]>)[name] ?? [];
}

function joinNames(codes: readonly string[]): string {
  return codes.map(nameCountry).join(', ');
}

/** The first few names, then how many more: "Austria, Belgium, Bulgaria and 26 more". */
function describeList(codes: readonly string[]): string {
  if (codes.length === 0) return 'No countries yet';
  const rest = codes.length - PREVIEW_COUNT;
  return `${joinNames(codes.slice(0, PREVIEW_COUNT))}${rest > 0 ? ` and ${rest} more` : ''}`;
}

export interface CountryPickerProps {
  schema: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}

/** The source select's value for an explicit list, beside the preset names. */
const CUSTOM = 'custom';

/** A source dropdown (a preset, or a custom list), and for a custom list a dropdown of countries. */
export function CountryPicker({
  schema,
  value,
  onChange,
  readOnly,
}: CountryPickerProps): ReactElement {
  const presetNames = readPresetNames(schema);
  const isPreset = typeof value === 'string';
  const codes = isPreset ? readPreset(value) : Array.isArray(value) ? (value as string[]) : [];
  const sources = [
    ...presetNames.map((name) => ({
      value: name,
      label: `${labelPreset(name)} · ${readPreset(name).length} countries`,
    })),
    { value: CUSTOM, label: 'Custom list' },
  ];

  return (
    <div className="flex flex-col gap-2">
      {presetNames.length > 0 && (
        <Select
          items={sources}
          value={isPreset ? value : CUSTOM}
          disabled={readOnly}
          aria-label="Countries from"
          // A custom list starts from the preset it replaces, so a small change stays small.
          onValueChange={(next) => onChange(next === CUSTOM ? [...codes] : next)}
        />
      )}
      {!isPreset && (
        <CountryDropdown
          selected={codes}
          summary={describeList(codes)}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** A select-styled trigger summing up the list; the searchable checklist opens beneath it. */
function CountryDropdown({
  selected,
  summary,
  readOnly,
  onChange,
}: {
  selected: readonly string[];
  summary: string;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}): ReactElement {
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={readOnly}
        title={joinNames(selected)}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 border border-border-strong bg-tsh-white px-3 text-left enabled:hover:border-tsh-black disabled:bg-bg-subtle"
      >
        <Typography
          variant="body-sm"
          as="span"
          className={cn('truncate', selected.length === 0 && 'text-tsh-red')}
        >
          <span className="text-fg-1">{selected.length} countries</span>
          <span className="text-fg-3"> · {summary}</span>
        </Typography>
        <svg
          aria-hidden
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          className="shrink-0 text-fg-3"
        >
          <path d="M1 1l4 4 4-4" strokeWidth="1.5" />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-50">
          <Popover.Popup className="w-(--anchor-width) border border-border-strong bg-tsh-white shadow-md">
            <CountryChecklist selected={selected} onChange={onChange} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CountryChecklist({
  selected,
  onChange,
}: {
  selected: readonly string[];
  onChange: (value: unknown) => void;
}): ReactElement {
  const countries = useMemo(listCountries, []);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = countries
    .filter(
      (country) =>
        needle === '' ||
        country.name.toLowerCase().includes(needle) ||
        country.code.toLowerCase() === needle,
    )
    // Selected first, so what is in the list is visible without scrolling the whole world.
    .sort((a, b) => Number(selected.includes(b.code)) - Number(selected.includes(a.code)));
  const toggle = (code: string): void =>
    onChange(
      selected.includes(code) ? selected.filter((entry) => entry !== code) : [...selected, code],
    );

  return (
    <div className="flex flex-col">
      <input
        autoFocus
        className="border-b border-border-rule px-2 py-1.5 text-body-sm outline-none"
        placeholder="Search countries"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex max-h-52 flex-col overflow-y-auto py-1">
        {matches.map((country) => (
          <label
            key={country.code}
            className="flex cursor-pointer items-center gap-2 px-2 py-0.5 hover:bg-bg-subtle"
          >
            <input
              type="checkbox"
              checked={selected.includes(country.code)}
              onChange={() => toggle(country.code)}
            />
            <Typography variant="body-sm" as="span" className="truncate">
              {country.name}
            </Typography>
            <Typography variant="meta" as="span" className="ml-auto font-mono">
              {country.code}
            </Typography>
          </label>
        ))}
        {matches.length === 0 && (
          <Typography variant="meta" className="px-2 py-1">
            No country matches “{query}”
          </Typography>
        )}
      </div>
    </div>
  );
}
