import { useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { Connector } from '@/api/connectors/connectors';
import { Button } from '@/components/ui/Button/Button';
import { Chip, type ChipTone } from '@/components/ui/Chip/Chip';
import { Info } from '@/components/ui/icons';
import { Typography } from '@/components/ui/Typography/Typography';
import { formatDateTime, formatNullableText } from '@/lib/format-date-time';
import type { ConnectorWriteOutcome } from '../../../hooks/useConnectors';
import {
  buildConnectorSettingsChanges,
  buildConnectorSettingsDefaults,
  buildConnectorSettingsResetValues,
  describeConnectorSettingsIssue,
  hasConnectorSettingsChanges,
  type ConnectorSettingsFormValues,
} from '../../../utils/connector-settings-form';
import { ConnectorSettingField } from './ConnectorSettingField/ConnectorSettingField';

export interface ConnectorCardProps {
  connector: Connector;
  onSave: (changes: Record<string, string | null>) => Promise<ConnectorWriteOutcome>;
  onClear: () => Promise<ConnectorWriteOutcome>;
}

function describeStatus(connector: Connector): { label: string; tone: ChipTone } {
  if (connector.settings.length === 0) {
    return { label: 'No settings', tone: 'neutral' };
  }

  return connector.configured
    ? { label: 'Configured', tone: 'strong' }
    : { label: 'Not configured', tone: 'outline' };
}

/**
 * One connector's settings form on its own `useForm`, so two cards can never clobber each other.
 * Save sends only what `buildConnectorSettingsChanges` finds changed against
 * `formState.defaultValues`, so a stored secret's blank box is never read as a deletion. Clear is
 * an irreversible `DELETE`, so it sits behind a confirm step.
 */
export function ConnectorCard({ connector, onSave, onClear }: ConnectorCardProps): ReactElement {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const idPrefix = `connector-${connector.id}`;
  const hasSettings = connector.settings.length > 0;

  const { control, handleSubmit, reset, setError, clearErrors, formState } =
    useForm<ConnectorSettingsFormValues>({
      defaultValues: buildConnectorSettingsDefaults(connector.settings),
    });

  // Held here, not above the list: a write is this card's own, and a shared slot re-enables one
  // card's controls the moment another's write settles.
  const pending = formState.isSubmitting || clearing;

  // Unscoped on purpose: the submit gate must trim-compare every value against its default, and
  // `dirtyFields` doesn't trim, so nothing narrower would do.
  const values = useWatch({ control });
  const defaultValues = formState.defaultValues ?? {};
  const canSubmit = hasConnectorSettingsChanges(values, defaultValues, connector.settings);

  // `configured` only means "no required key missing", and `smtp` declares none — so it reads
  // true on an empty settings map. The note stops an operator reading the empty form as a bug.
  const hasNoStoredSettings = connector.settings.every((setting) => setting.source === 'unset');

  async function onSubmit(submittedValues: ConnectorSettingsFormValues): Promise<void> {
    const changes = buildConnectorSettingsChanges(
      submittedValues,
      defaultValues,
      connector.settings,
    );
    if (Object.keys(changes).length === 0 || clearing) {
      return;
    }

    clearErrors();
    const outcome = await onSave(changes);

    if (outcome.ok) {
      // `saveSettings` does not await its refetch, so `connector` is still pre-save data here.
      // Reset to what was just sent — resetting from `connector` would re-offer the old value.
      reset(buildConnectorSettingsResetValues(submittedValues, connector.settings));
    } else {
      // The engine may report several reasons per key, most specific first, and `setError`
      // replaces rather than appends — so keep each key's first and drop the vaguer rest.
      const reportedKeys = new Set<string>();

      for (const issue of outcome.error.issues) {
        if (reportedKeys.has(issue.key)) {
          continue;
        }

        reportedKeys.add(issue.key);
        setError(issue.key, {
          type: 'server',
          message: describeConnectorSettingsIssue(issue.reason),
        });
      }
    }
  }

  async function handleClearConfirmed(): Promise<void> {
    clearErrors();
    setClearing(true);

    try {
      const outcome = await onClear();

      if (outcome.ok) {
        reset(buildConnectorSettingsResetValues({}, connector.settings));
      }
    } finally {
      setClearing(false);
    }
  }

  function handleClearClick(): void {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    void handleClearConfirmed();
  }

  const status = describeStatus(connector);

  return (
    <form
      className="border border-border-hair"
      aria-label={`${connector.name} connector settings`}
      onSubmit={handleSubmit(onSubmit)}
    >
      <header className="flex items-start justify-between gap-6 border-b border-border-hair p-6">
        <div className="flex flex-col gap-1.5">
          <Typography variant="body-lg" as="h3" className="font-regular text-fg-1">
            {connector.name}
          </Typography>
          <Typography variant="mono" as="p" className="text-fg-3">
            {connector.id === connector.name
              ? `type ${connector.type}`
              : `${connector.id} · type ${connector.type}`}
          </Typography>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Chip size="status" tone={status.tone}>
            {status.label}
          </Chip>
          {connector.updatedAt === null ? null : (
            <Typography variant="meta" as="p">
              Updated {formatDateTime(connector.updatedAt)} by{' '}
              {formatNullableText(connector.updatedBy)}
            </Typography>
          )}
        </div>
      </header>

      {hasSettings ? (
        <>
          <div className="flex flex-col gap-5 p-6">
            {connector.configured && hasNoStoredSettings && (
              <Typography variant="body-sm">No settings are stored for this connector.</Typography>
            )}
            {connector.settings.map((setting) => (
              <ConnectorSettingField
                key={setting.key}
                idPrefix={idPrefix}
                setting={setting}
                control={control}
                disabled={pending}
              />
            ))}
          </div>
          <footer className="flex items-center gap-3 border-t border-border-hair px-6 py-5">
            <Button type="submit" variant="primary" size="lg" disabled={!canSubmit || pending}>
              Save
            </Button>
            <div className="ml-auto flex items-center gap-3">
              {confirmingClear && (
                <Typography variant="body-sm" as="span">
                  Clear this connector&apos;s settings?
                </Typography>
              )}
              {confirmingClear && (
                <Button
                  variant="quiet"
                  size="lg"
                  disabled={pending}
                  onClick={() => setConfirmingClear(false)}
                >
                  Cancel
                </Button>
              )}
              <Button variant="danger" size="lg" disabled={pending} onClick={handleClearClick}>
                {confirmingClear ? 'Confirm clear' : 'Clear settings'}
              </Button>
            </div>
          </footer>
        </>
      ) : (
        <div className="flex items-center gap-3 px-6 py-5">
          <Info aria-hidden="true" focusable="false" className="size-4.5 text-fg-4" />
          <Typography variant="body-sm">
            This adapter declares no settings schema, so there is nothing to configure.
          </Typography>
        </div>
      )}
    </form>
  );
}
