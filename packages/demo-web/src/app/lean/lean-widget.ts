import type { LeanLink } from '@/api/bnpl/bnpl.client';

/** Lean's LinkSDK loader for the KSA production environment; `sandbox: true` selects the sandbox. */
export const LEAN_LOADER_URL =
  'https://cdn.leantech.me/link/loader/prod/sa/latest/lean-link-loader.min.js';
const LOADER_SCRIPT_ID = 'lean-link-loader';

/** What the widget reports when it closes; `exit_point` and `last_api_response` are what Lean support asks for. */
export interface LeanCallbackData {
  status?: string;
  method?: string;
  message?: string;
  exit_point?: string;
  last_api_response?: string;
  lean_correlation_id?: string;
  [key: string]: unknown;
}

interface LeanSdk {
  connect(options: {
    app_token: string;
    customer_id: string;
    access_token: string;
    permissions: string[];
    account_type: string;
    success_redirect_url: string;
    fail_redirect_url: string;
    sandbox: boolean;
    bank_identifier?: string;
    callback: (result: LeanCallbackData) => void;
  }): void;
}

declare global {
  interface Window {
    Lean?: LeanSdk;
  }
}

let loader: Promise<LeanSdk> | undefined;

/** Loads the LinkSDK once per page and answers it. */
export function loadLeanSdk(): Promise<LeanSdk> {
  if (window.Lean !== undefined) {
    return Promise.resolve(window.Lean);
  }
  if (loader === undefined) {
    loader = new Promise<LeanSdk>((resolve, reject) => {
      const existing = document.getElementById(LOADER_SCRIPT_ID);
      const script =
        existing instanceof HTMLScriptElement ? existing : document.createElement('script');

      script.addEventListener('load', () => {
        if (window.Lean === undefined) {
          reject(new Error('The Lean widget loaded but did not register itself.'));
        } else {
          resolve(window.Lean);
        }
      });
      script.addEventListener('error', () => {
        loader = undefined;
        reject(new Error('Could not load the Lean widget.'));
      });
      if (!(existing instanceof HTMLScriptElement)) {
        script.id = LOADER_SCRIPT_ID;
        script.src = LEAN_LOADER_URL;
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }

  return loader;
}

/**
 * Opens the widget with what the BFF answered. The widget's own callback only reports the widget's
 * closing; the engine learns the outcome from Lean's webhook, which is what the waiting page polls.
 */
export async function connectLean(
  link: LeanLink,
  options: { bankIdentifier?: string; callback: (result: LeanCallbackData) => void },
): Promise<void> {
  const sdk = await loadLeanSdk();

  sdk.connect({
    app_token: link.appToken,
    customer_id: link.customerId,
    access_token: link.accessToken,
    permissions: link.permissions,
    account_type: link.accountType,
    success_redirect_url: link.successRedirectUrl,
    fail_redirect_url: link.failRedirectUrl,
    sandbox: link.sandbox,
    ...(options.bankIdentifier === undefined ? {} : { bank_identifier: options.bankIdentifier }),
    callback: options.callback,
  });
}
