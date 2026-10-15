import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { BffError, submitSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';

const schema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(100),
  lastName: z.string().trim().min(1, 'Enter your last name').max(100),
  email: z.string().trim().email('Enter a valid email address'),
});

type DetailsValues = z.infer<typeof schema>;

const PERSONA_DEFAULTS: Record<string, DetailsValues> = {
  sherlock_holmes: {
    firstName: 'Sherlock',
    lastName: 'Holmes',
    email: 'sherlock.holmes@example.com',
  },
  james_watson: { firstName: 'James', lastName: 'Watson', email: 'james.watson@example.com' },
  james_moriarty: {
    firstName: 'James',
    lastName: 'Moriarty',
    email: 'james.moriarty@example.com',
  },
};

const EMPTY: DetailsValues = { firstName: '', lastName: '', email: '' };

export function defaultsFor(persona: string): DetailsValues {
  return PERSONA_DEFAULTS[persona] ?? EMPTY;
}

export function DetailsPage() {
  const state = useSessionView('details');
  const navigate = useNavigate();
  const form = useForm<DetailsValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const persona = state.status === 'ready' ? state.view.persona : null;
  const { reset } = form;

  useEffect(() => {
    if (persona !== null) {
      reset(defaultsFor(persona));
    }
  }, [persona, reset]);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token } = state;
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: DetailsValues) {
    try {
      await submitSession(token, values);
      void navigate(sessionPath(token, 'consent'));
    } catch (error) {
      if (error instanceof BffError && error.errors !== undefined) {
        for (const [name, codes] of Object.entries(error.errors)) {
          if (name === 'firstName' || name === 'lastName' || name === 'email') {
            form.setError(name, { message: codes.join(', ') });
          }
        }
      } else {
        form.setError('root', {
          message: error instanceof Error ? error.message : 'Could not save your details.',
        });
      }
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>We prefilled these for the chosen scenario.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        >
          {(['firstName', 'lastName', 'email'] as const).map((name) => (
            <div key={name} className="flex flex-col gap-1.5">
              <Label htmlFor={name}>
                {name === 'firstName' ? 'First name' : name === 'lastName' ? 'Last name' : 'Email'}
              </Label>
              <Input
                id={name}
                type={name === 'email' ? 'email' : 'text'}
                aria-invalid={errors[name] !== undefined}
                aria-describedby={errors[name] === undefined ? undefined : `${name}-error`}
                {...form.register(name)}
              />
              {errors[name] === undefined ? null : (
                <p id={`${name}-error`} className="text-sm text-destructive">
                  {errors[name].message}
                </p>
              )}
            </div>
          ))}
          {errors.root === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Continue'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
