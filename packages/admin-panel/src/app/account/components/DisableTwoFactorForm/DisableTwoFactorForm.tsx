import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { accountMutations } from '@/api/account/account-mutations';
import { Button } from '@/components/ui/Button/Button';
import { SecretFormField } from '@/components/ui/form/SecretFormField/SecretFormField';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

export interface DisableTwoFactorFormProps {
  onCancel: () => void;
}

const disableSchema = z.object({ password: z.string().min(1, 'Enter your password.') });

type DisableValues = z.infer<typeof disableSchema>;

/** Turns two-factor authentication off after the operator confirms their password. */
export function DisableTwoFactorForm({ onCancel }: DisableTwoFactorFormProps): ReactElement {
  const disable = useMutation(accountMutations.disableTwoFactor());
  const { control, handleSubmit } = useForm<DisableValues>({
    defaultValues: { password: '' },
    resolver: zodResolver(disableSchema),
  });

  const submit = handleSubmit(({ password }) => {
    disable.mutate(password, {
      onSuccess: () => showSuccessToast('Two-factor authentication turned off'),
      onError: (error) => showErrorToast('Two-factor authentication not turned off', error.message),
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex max-w-110 flex-col gap-4">
      <SecretFormField
        autoComplete="current-password"
        control={control}
        name="password"
        controlId="two-factor-disable-password"
        label="Password"
        revealLabel="password"
        isRequired
      />
      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={disable.isPending}>
          {disable.isPending ? 'Turning off…' : 'Turn off'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
