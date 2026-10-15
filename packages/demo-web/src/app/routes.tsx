import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { ConsentPage } from './consent/ConsentPage';
import { DetailsPage } from './details/DetailsPage';
import { PersonaPage } from './personas/PersonaPage';
import { StartPage } from './personas/StartPage';
import { ProcessingPage } from './processing/ProcessingPage';
import { ResultPage } from './result/ResultPage';
import { RunPage } from './run/RunPage';
import { SessionNotFound } from './session/useSessionView';

/** Route table; `Layout` is the shell the pages render inside. */
export function AppRoutes({ layout }: { layout: ReactElement }) {
  return (
    <Routes>
      <Route element={layout}>
        <Route index element={<PersonaPage />} />
        <Route path="start/:persona" element={<StartPage />} />
        <Route path="s/:token/details" element={<DetailsPage />} />
        <Route path="s/:token/consent" element={<ConsentPage />} />
        <Route path="s/:token/run" element={<RunPage />} />
        <Route path="s/:token/processing" element={<ProcessingPage />} />
        <Route path="s/:token/result" element={<ResultPage />} />
        <Route path="*" element={<SessionNotFound />} />
      </Route>
    </Routes>
  );
}
