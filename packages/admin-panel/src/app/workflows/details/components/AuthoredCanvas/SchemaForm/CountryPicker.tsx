import { useMemo, useState, type ReactElement } from 'react';
import { Popover } from '@base-ui/react/popover';
import {
  ALPHA_2_PATTERN,
  COUNTRY_PRESETS,
  EEA_ID_CARD_ISSUERS_PRESET,
  EEA_PRESET,
} from '@tsh/ddl-schema/step-types';
import { Input } from '@/components/ui/Input/Input';
import { Select, selectTriggerClassName } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { cn } from '@/lib/cn';
import { resolveSchema, type Schema } from '../../../utils/config-schema';
import { Checkbox } from '../Checkbox';

/** A country schema is `anyOf` exactly a preset name and a code list. */
const COUNTRY_SCHEMA_VARIANTS = 2;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PREVIEW_COUNT = 3;

const PRESET_LABELS: Partial<Record<PresetName, string>> = {
  [EEA_PRESET]: 'EEA',
  [EEA_ID_CARD_ISSUERS_PRESET]: 'EEA ID-card issuers',
};

/** The source select's value for an explicit list, beside the preset names. */
const CUSTOM = 'custom';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function nameCountry(code: string): string {
  return regionNames.of(code) ?? code;
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
  return (
    resolved.type === 'array' && resolveSchema(resolved.items ?? {}).pattern === ALPHA_2_PATTERN
  );
}

/** A plain list of alpha-2 codes, or `anyOf` a preset name and such a list. */
export function isCountrySchema(schema: Schema): boolean {
  const resolved = resolveSchema(schema);
  if (isAlpha2List(resolved)) return true;
  const variants = (resolved.anyOf ?? []).map(resolveSchema);
  return (
    variants.length === COUNTRY_SCHEMA_VARIANTS &&
    variants.some((variant) => variant.enum) &&
    variants.some(isAlpha2List)
  );
}

function readPresetNames(schema: Schema): string[] {
  const presets = (resolveSchema(schema).anyOf ?? [])
    .map(resolveSchema)
    .find((variant) => variant.enum);
  return (presets?.enum ?? []).filter((name): name is string => typeof name === 'string');
}

type PresetName = keyof typeof COUNTRY_PRESETS;

function isPresetName(name: string): name is PresetName {
  return name in COUNTRY_PRESETS;
}

function readPreset(name: string): readonly string[] {
  return isPresetName(name) ? COUNTRY_PRESETS[name] : [];
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
      label: `${(isPresetName(name) ? PRESET_LABELS[name] : undefined) ?? name} · ${readPreset(name).length} countries`,
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
      {!isPreset && <CountryDropdown selected={codes} readOnly={readOnly} onChange={onChange} />}
    </div>
  );
}

interface CountryDropdownProps {
  selected: readonly string[];
  readOnly: boolean;
  onChange: (value: unknown) => void;
}

/** A select-styled trigger summing up the list; the searchable checklist opens beneath it. */
function CountryDropdown({ selected, readOnly, onChange }: CountryDropdownProps): ReactElement {
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={readOnly}
        aria-label="Countries"
        title={joinNames(selected)}
        className={cn(selectTriggerClassName, 'cursor-pointer')}
      >
        <span className={cn('truncate', selected.length === 0 && 'text-tsh-red')}>
          <Typography variant="body-sm" as="span" className="text-fg-1">
            {selected.length} countries
          </Typography>
          <Typography variant="body-sm" as="span">
            {' · '}
            {describeList(selected)}
          </Typography>
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-50">
          <Popover.Popup className="w-(--anchor-width) border border-border-strong bg-bg-page shadow-md">
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
      <Input
        size="sm"
        aria-label="Search countries"
        placeholder="Search countries"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex max-h-52 flex-col overflow-y-auto py-1">
        {matches.map((country) => (
          <Typography
            key={country.code}
            variant="body-sm"
            as="label"
            className="flex cursor-pointer items-center gap-2 px-2 py-0.5 hover:bg-bg-subtle"
          >
            <Checkbox
              checked={selected.includes(country.code)}
              onChange={() => toggle(country.code)}
            />
            <span className="truncate">{country.name}</span>
            <Typography variant="mono" as="span" className="ml-auto text-fg-4">
              {country.code}
            </Typography>
          </Typography>
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
