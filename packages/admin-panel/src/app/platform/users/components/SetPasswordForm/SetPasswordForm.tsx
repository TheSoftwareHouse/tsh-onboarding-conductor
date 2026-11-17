import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { platformMutations } from '@/api/platform/platform-mutations';
import { Button } from '@/components/ui/Button/Button';
import { TextFormField } from '@/components/ui/form/TextFormField/TextFormField';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';

/** better-auth's own default bounds for a password. */
const MIN_PASSWORD_LENGTH = 8;

const passwordSchema = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
});

type PasswordValues = z.infer<typeof passwordSchema>;

export interface SetPasswordFormProps {
  userId: string;
  email: string;
  onDone: () => void;
}

/** Sets a temporary password for one user; the user changes it through "Forgot password". */
export function SetPasswordForm({ userId, email, onDone }: SetPasswordFormProps): ReactElement {
  const setPassword = useMutation(platformMutations.setPassword());
  const { control, handleSubmit } = useForm<PasswordValues>({
    defaultValues: { password: '' },
    resolver: zodResolver(passwordSchema),
  });

  const submit = handleSubmit(({ password }) => {
    setPassword.mutate(
      { userId, password },
      {
        onSuccess: () => {
          showSuccessToast(`Password of ${email} set`);
          onDone();
        },
        onError: (error) => showErrorToast('Password not set', error.message),
      },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-4">
      <div className="w-80">
        <TextFormField
          control={control}
          name="password"
          controlId="platform-user-password"
          label={`Temporary password for ${email}`}
          autoComplete="new-password"
          isRequired
        />
      </div>
      <Button type="submit" variant="primary" disabled={setPassword.isPending}>
        {setPassword.isPending ? 'Setting…' : 'Set password'}
      </Button>
      <Button type="button" variant="secondary" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
