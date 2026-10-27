import { createContext, useContext } from 'react';
import type { ConfigFailures } from '../../../utils/check-config';

export interface ConfigFormContextValue {
  /** The step type whose config the form draws; its hints are looked up by it. */
  stepType: string | null;
  /** Renames a root `config.fields` entry and its references; returns whether the references followed. */
  renameField: ((from: string, to: string) => boolean) | null;
  /** The settings that fail the type's schema, by path; each shows its reason under its control. */
  failures: ConfigFailures;
}

export const ConfigFormContext = createContext<ConfigFormContextValue>({
  stepType: null,
  renameField: null,
  failures: {},
});

export function useConfigFormContext(): ConfigFormContextValue {
  return useContext(ConfigFormContext);
}
