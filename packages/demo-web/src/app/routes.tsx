import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { AccountsPage } from './bank/AccountsPage';
import { BankConsentPage } from './bank/BankConsentPage';
import { BankLinkPage } from './bank/BankLinkPage';
import { BankLoginPage } from './bank/BankLoginPage';
import { BankPage } from './bank/BankPage';
import { BankTransferPage } from './bank/BankTransferPage';
import { BankWaitingPage } from './bank/BankWaitingPage';
import { ConsentPage } from './consent/ConsentPage';
import { DetailsPage } from './details/DetailsPage';
import { HomePage } from './home/HomePage';
import { StartPage } from './personas/StartPage';
import { ProcessingPage } from './processing/ProcessingPage';
import { ResultPage } from './result/ResultPage';
import { SessionNotFound } from './session/useSessionView';

/** Route table; `Layout` is the shell the pages render inside. */
export function AppRoutes({ layout }: { layout: ReactElement }) {
  return (
    <Routes>
      <Route element={layout}>
        <Route index element={<HomePage />} />
        <Route path="start/:persona" element={<StartPage />} />
        <Route path="s/:token/details" element={<DetailsPage />} />
        <Route path="s/:token/consent" element={<ConsentPage />} />
        <Route path="s/:token/bank" element={<BankPage />} />
        <Route path="s/:token/bank/login" element={<BankLoginPage />} />
        <Route path="s/:token/bank/transfer" element={<BankTransferPage />} />
        <Route path="s/:token/bank/link" element={<BankLinkPage />} />
        <Route path="s/:token/bank/waiting" element={<BankWaitingPage />} />
        <Route path="s/:token/accounts" element={<AccountsPage />} />
        <Route path="s/:token/bank/consent" element={<BankConsentPage />} />
        <Route path="s/:token/processing" element={<ProcessingPage />} />
        <Route path="s/:token/result" element={<ResultPage />} />
        <Route path="*" element={<SessionNotFound />} />
      </Route>
    </Routes>
  );
}
