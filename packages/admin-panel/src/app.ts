import { fetchAdminOnboardings, type AdminOnboardingsFetchError } from './api/admin-onboardings';
import { filterAdminOnboardings, type AdminOnboardingFilters } from './filter-admin-onboardings';
import type { AdminOnboardingSummary } from './types/admin-onboarding';

const NOT_SET = '-';
const INVALID_DATE = 'Invalid date';
const WORKFLOW_VERSION_ERROR_MESSAGE = 'Enter a whole number greater than zero.';
const TABLE_COLUMN_COUNT = 9;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type Phase = 'loading' | 'error' | 'ready';
type CellKind = 'identifier' | 'timestamp' | 'description';

interface AppState {
  phase: Phase;
  records: AdminOnboardingSummary[];
  error: AdminOnboardingsFetchError | null;
  filters: AdminOnboardingFilters;
}

interface ShellRefs {
  form: HTMLFormElement;
  statusSelect: HTMLSelectElement;
  workflowIdInput: HTMLInputElement;
  workflowVersionInput: HTMLInputElement;
  workflowVersionError: HTMLParagraphElement;
  currentStepInput: HTMLInputElement;
  onboardingIdInput: HTMLInputElement;
  reloadButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  statusRegion: HTMLParagraphElement;
  tableWrapper: HTMLDivElement;
  tableBody: HTMLTableSectionElement;
}

function createDefaultFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID_DATE : DATE_TIME_FORMATTER.format(date);
}

function formatNullableDateTime(value: string | null): string {
  return value === null ? NOT_SET : formatDateTime(value);
}

function formatNullableText(value: string | null): string {
  return value === null ? NOT_SET : value;
}

function describeFetchError(error: AdminOnboardingsFetchError): string {
  return `Unable to load onboardings: ${error.message}`;
}

function createField(
  labelText: string,
  input: HTMLInputElement | HTMLSelectElement,
  extra?: HTMLElement,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = labelText;
  field.append(label, input);
  if (extra) {
    field.append(extra);
  }
  return field;
}

function createTextInput(id: string, name: string, numeric = false): HTMLInputElement {
  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = 'text';
  input.autocomplete = 'off';
  if (numeric) {
    input.inputMode = 'numeric';
  }
  return input;
}

function createCell(text: string, kind: CellKind): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = kind;
  cell.textContent = text;
  return cell;
}

/**
 * Builds the static page shell once. Filter inputs, the status region, and the table body
 * are updated in place afterwards so typing in a filter field never loses focus.
 */
function buildShell(root: HTMLElement): ShellRefs {
  root.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'page';

  const heading = document.createElement('h1');
  heading.textContent = 'Admin onboardings';

  const form = document.createElement('form');
  form.className = 'filters';
  form.setAttribute('aria-label', 'Filter onboardings');

  const statusSelect = document.createElement('select');
  statusSelect.id = 'status-filter';
  statusSelect.name = 'status';
  statusSelect.append(
    new Option('All', ''),
    new Option('Awaiting user', 'awaiting_user'),
    new Option('Approved', 'approved'),
  );

  const workflowIdInput = createTextInput('workflow-id-filter', 'workflowId');
  const workflowVersionInput = createTextInput('workflow-version-filter', 'workflowVersion', true);
  workflowVersionInput.setAttribute('aria-describedby', 'workflow-version-error');
  const workflowVersionError = document.createElement('p');
  workflowVersionError.id = 'workflow-version-error';
  workflowVersionError.className = 'field-error';
  workflowVersionError.textContent = WORKFLOW_VERSION_ERROR_MESSAGE;
  workflowVersionError.hidden = true;

  const currentStepInput = createTextInput('current-step-filter', 'currentStep');
  const onboardingIdInput = createTextInput('onboarding-id-filter', 'onboardingId');

  const actions = document.createElement('div');
  actions.className = 'actions';
  const reloadButton = document.createElement('button');
  reloadButton.type = 'submit';
  reloadButton.textContent = 'Reload';
  const resetButton = document.createElement('button');
  resetButton.type = 'reset';
  resetButton.textContent = 'Reset filters';
  actions.append(reloadButton, resetButton);

  form.append(
    createField('Status', statusSelect),
    createField('Workflow ID', workflowIdInput),
    createField('Workflow version', workflowVersionInput, workflowVersionError),
    createField('Current step', currentStepInput),
    createField('Onboarding ID', onboardingIdInput),
    actions,
  );

  const statusRegion = document.createElement('p');
  statusRegion.className = 'status-region';
  statusRegion.setAttribute('role', 'status');
  statusRegion.setAttribute('aria-live', 'polite');

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-wrapper';
  tableWrapper.tabIndex = 0;
  tableWrapper.setAttribute('role', 'region');
  tableWrapper.setAttribute('aria-label', 'Onboardings results');
  tableWrapper.hidden = true;

  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.className = 'visually-hidden';
  caption.textContent = 'Onboardings matching the current filters';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const columns = [
    'Onboarding ID',
    'Workflow ID',
    'Workflow version',
    'Status',
    'Current step',
    'Expires at',
    'Created at',
    'Updated at',
    'Completed at',
  ];
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    headerRow.append(th);
  }
  thead.append(headerRow);

  const tableBody = document.createElement('tbody');
  table.append(caption, thead, tableBody);
  tableWrapper.append(table);

  page.append(heading, form, statusRegion, tableWrapper);
  root.append(page);

  return {
    form,
    statusSelect,
    workflowIdInput,
    workflowVersionInput,
    workflowVersionError,
    currentStepInput,
    onboardingIdInput,
    reloadButton,
    resetButton,
    statusRegion,
    tableWrapper,
    tableBody,
  };
}

function setControlsDisabled(refs: ShellRefs, disabled: boolean): void {
  refs.statusSelect.disabled = disabled;
  refs.workflowIdInput.disabled = disabled;
  refs.workflowVersionInput.disabled = disabled;
  refs.currentStepInput.disabled = disabled;
  refs.onboardingIdInput.disabled = disabled;
  refs.reloadButton.disabled = disabled;
  refs.resetButton.disabled = disabled;
}

function renderTableRows(
  refs: ShellRefs,
  records: readonly AdminOnboardingSummary[],
  emptyMessage: string,
): void {
  refs.tableBody.innerHTML = '';

  if (records.length === 0) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = TABLE_COLUMN_COUNT;
    cell.textContent = emptyMessage;
    row.append(cell);
    refs.tableBody.append(row);
    return;
  }

  for (const record of records) {
    const row = document.createElement('tr');
    row.append(
      createCell(record.onboardingId, 'identifier'),
      createCell(record.workflowId, 'identifier'),
      createCell(String(record.workflowVersion), 'identifier'),
      createCell(record.status, 'identifier'),
      createCell(formatNullableText(record.currentStep), 'description'),
      createCell(formatNullableDateTime(record.expiresAt), 'timestamp'),
      createCell(formatDateTime(record.createdAt), 'timestamp'),
      createCell(formatDateTime(record.updatedAt), 'timestamp'),
      createCell(formatNullableDateTime(record.completedAt), 'timestamp'),
    );
    refs.tableBody.append(row);
  }
}

function renderReady(refs: ShellRefs, state: AppState): void {
  refs.tableWrapper.hidden = false;
  setControlsDisabled(refs, false);

  const filterResult = filterAdminOnboardings(state.records, state.filters);

  refs.workflowVersionInput.setAttribute(
    'aria-invalid',
    filterResult.workflowVersionInvalid ? 'true' : 'false',
  );
  refs.workflowVersionError.hidden = !filterResult.workflowVersionInvalid;

  if (filterResult.workflowVersionInvalid) {
    refs.statusRegion.textContent = WORKFLOW_VERSION_ERROR_MESSAGE;
    renderTableRows(refs, [], 'Enter a valid workflow version to see results.');
    return;
  }

  if (state.records.length === 0) {
    refs.statusRegion.textContent = 'No onboardings were returned.';
    renderTableRows(refs, [], 'No onboardings were returned.');
    return;
  }

  if (filterResult.records.length === 0) {
    refs.statusRegion.textContent = 'No onboardings match the current filters.';
    renderTableRows(refs, [], 'No onboardings match the current filters.');
    return;
  }

  refs.statusRegion.textContent = `Showing ${filterResult.records.length} of ${state.records.length} onboardings.`;
  renderTableRows(refs, filterResult.records, '');
}

function render(refs: ShellRefs, state: AppState): void {
  if (state.phase === 'loading') {
    refs.tableWrapper.hidden = true;
    setControlsDisabled(refs, true);
    refs.statusRegion.textContent = 'Loading onboardings…';
    return;
  }

  if (state.phase === 'error') {
    refs.tableWrapper.hidden = true;
    setControlsDisabled(refs, false);
    refs.statusRegion.textContent = state.error
      ? describeFetchError(state.error)
      : 'Unable to load onboardings.';
    return;
  }

  renderReady(refs, state);
}

async function loadOnboardings(refs: ShellRefs, state: AppState): Promise<void> {
  state.phase = 'loading';
  render(refs, state);

  const result = await fetchAdminOnboardings();

  if (result.ok) {
    state.phase = 'ready';
    state.records = result.data;
    state.error = null;
  } else {
    state.phase = 'error';
    state.error = result.error;
  }

  render(refs, state);
}

/** Mounts the framework-free admin onboardings page inside the given root element. */
export function mountAdminOnboardingsApp(root: HTMLElement): void {
  const refs = buildShell(root);
  const state: AppState = {
    phase: 'loading',
    records: [],
    error: null,
    filters: createDefaultFilters(),
  };

  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.phase === 'loading') {
      return;
    }
    void loadOnboardings(refs, state);
  });

  refs.form.addEventListener('reset', () => {
    state.filters = createDefaultFilters();
    if (state.phase === 'ready') {
      render(refs, state);
    }
  });

  const updateFilter = <K extends keyof AdminOnboardingFilters>(
    key: K,
    value: AdminOnboardingFilters[K],
  ): void => {
    state.filters = { ...state.filters, [key]: value };
    if (state.phase === 'ready') {
      render(refs, state);
    }
  };

  refs.statusSelect.addEventListener('change', () => {
    updateFilter('status', refs.statusSelect.value as AdminOnboardingFilters['status']);
  });
  refs.workflowIdInput.addEventListener('input', () => {
    updateFilter('workflowId', refs.workflowIdInput.value);
  });
  refs.workflowVersionInput.addEventListener('input', () => {
    updateFilter('workflowVersion', refs.workflowVersionInput.value);
  });
  refs.currentStepInput.addEventListener('input', () => {
    updateFilter('currentStep', refs.currentStepInput.value);
  });
  refs.onboardingIdInput.addEventListener('input', () => {
    updateFilter('onboardingId', refs.onboardingIdInput.value);
  });

  void loadOnboardings(refs, state);
}
