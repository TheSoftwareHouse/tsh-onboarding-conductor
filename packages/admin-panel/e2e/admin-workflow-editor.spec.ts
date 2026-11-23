import { expect, test, type Locator, type Page } from '@playwright/test';

const APP_URL = process.env.BASE_URL || 'http://localhost:5174';

/** The running test's own draft, which the fake engine creates empty on first read. */
function draftUrl(): string {
  const { testId, repeatEachIndex } = test.info();
  return `${APP_URL}/workflows/editor-draft-${testId}-${repeatEachIndex}?version=1`;
}

/** Past the editor's undo-coalescing window, so the next edit is a step of its own. */
const UNDO_STEP_GAP_MS = 1000;

const SETTLE_POLL_INTERVAL_MS = 100;
/** Pixels in from the left and up from the bottom of a node, where a press lands on its body. */
const LOWER_LEFT_PRESS = { fromLeft: 20, fromBottom: 8 };
const BODY_PRESS_FROM_BOTTOM = 4;
/** Steps added in a row until the graph outgrows the pane. */
const STEPS_TO_OVERFLOW = 4;
const HALF = 0.5;

interface SavedStep {
  name: string;
  type: string;
  edges?: Record<string, unknown>;
  config?: Record<string, unknown>;
  meta?: { position?: { x: number; y: number } };
}

const STEP_LABEL_PREFIX = 'Step ';

function stepNode(page: Page, name: string): Locator {
  return page.getByRole('group', { name: `${STEP_LABEL_PREFIX}${name}`, exact: true });
}

function contactNode(page: Page): Locator {
  return stepNode(page, 'contact_details_1');
}

function canvasPane(page: Page): Locator {
  return page.getByRole('application', { name: 'Workflow canvas' });
}

/** Every step node; edges are groups too, but are named "Edge from …". */
function stepNodes(page: Page): Locator {
  return page.getByRole('group', { name: new RegExp(`^${STEP_LABEL_PREFIX}`) });
}

async function readStepIds(page: Page): Promise<string[]> {
  return stepNodes(page).evaluateAll(
    (nodes, prefix) =>
      nodes.map((node) => (node.getAttribute('aria-label') ?? '').slice(prefix.length)),
    STEP_LABEL_PREFIX,
  );
}

/** The locator's box once it has stopped moving, so a pan still animating is waited out. */
async function readSettledBox(locator: Locator): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        const seen = JSON.stringify(await locator.boundingBox());
        const settled = seen === last;
        last = seen;
        return settled;
      },
      { intervals: [SETTLE_POLL_INTERVAL_MS] },
    )
    .toBe(true);
  return last;
}

/** The step count line appears once the draft has loaded, so a step list read after it is complete. */
async function expectDraftLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/\d+ steps? · \d+ edges?/)).toBeVisible();
}

/** Adds a step with a click on its palette item and returns the id of the node that appeared. */
async function addStepByClick(page: Page, type: string): Promise<string> {
  const before = await readStepIds(page);
  await page.getByRole('button', { name: new RegExp(`^${type} `) }).click();
  await expect.poll(async () => (await readStepIds(page)).length).toBe(before.length + 1);
  return (await readStepIds(page)).find((id) => !before.includes(id))!;
}

async function expectNodeInsidePane(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => {
      const pane = await canvasPane(page).boundingBox();
      const node = await stepNode(page, id).boundingBox();
      if (!pane || !node) return false;
      return (
        node.width > 0 &&
        node.x >= pane.x &&
        node.y >= pane.y &&
        node.x + node.width <= pane.x + pane.width &&
        node.y + node.height <= pane.y + pane.height
      );
    })
    .toBe(true);
}

async function findLowestStepId(page: Page): Promise<string> {
  const lowest = await stepNodes(page).evaluateAll((nodes, prefix) => {
    const bottoms = nodes.map((node) => ({
      id: (node.getAttribute('aria-label') ?? '').slice(prefix.length),
      bottom: node.getBoundingClientRect().bottom,
    }));
    return bottoms.sort((a, b) => b.bottom - a.bottom)[0]?.id ?? '';
  }, STEP_LABEL_PREFIX);
  return lowest;
}

/** Presses a node at its lower left; a pan to a newly added step can leave the node under the overlay row. */
async function clickNodeLowerLeft(node: Locator): Promise<void> {
  // The offset is taken from the node's box once a pan has stopped moving it.
  await readSettledBox(node);
  const box = (await node.boundingBox())!;
  await node.click({
    position: { x: LOWER_LEFT_PRESS.fromLeft, y: box.height - LOWER_LEFT_PRESS.fromBottom },
  });
}

async function expectWiredCanvas(page: Page): Promise<void> {
  await expect(page.getByText('2 steps · 1 edge')).toBeVisible();
  await clickNodeLowerLeft(contactNode(page));
  await expect(page.getByRole('combobox', { name: 'Target of success' })).toHaveText('terminal_1');
}

test.describe('admin panel workflow draft editor', () => {
  test('should save a wired draft and show the same canvas after a reload', async ({ page }) => {
    // The editor merges edits under 500 ms apart into one undo step; the fake clock stands in for a pause.
    await page.clock.install();
    await page.goto(draftUrl());
    await expect(page.getByRole('tab', { name: 'Authored graph' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('button', { name: /^contact-details/ }).click();
    await page.getByRole('button', { name: /^terminal/ }).click();
    await expect(page.getByText('2 steps · 0 edges')).toBeVisible();

    // With the inspector open the pane is narrow and its overlays stack over the first step; closing it and fitting clears them.
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await clickNodeLowerLeft(contactNode(page));
    await page.getByRole('combobox', { name: 'Target of success' }).click();
    await page.getByRole('option', { name: 'terminal_1' }).click();
    await expect(page.getByText('2 steps · 1 edge')).toBeVisible();

    await page.clock.fastForward(UNDO_STEP_GAP_MS);
    await page.getByRole('button', { name: 'Configure' }).click();
    await page.getByRole('combobox', { name: 'Email' }).click();
    await page.getByRole('option', { name: 'optional' }).click();
    await expect(page.getByRole('combobox', { name: 'Email' })).toHaveText('optional');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('combobox', { name: 'Email' })).toHaveText('required');
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(page.getByRole('combobox', { name: 'Email' })).toHaveText('optional');

    const saveRequest = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().endsWith('/versions/1'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    const body = (await saveRequest).postDataJSON() as { steps: SavedStep[] };

    expect(body.steps.map((step) => step.type)).toEqual(['contact-details', 'terminal']);
    const [contact, terminal] = body.steps;
    expect(contact!.edges).toEqual({ success: 'terminal_1' });
    expect(contact!.config).toMatchObject({ email: 'optional' });
    expect(contact!.meta?.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(terminal!.meta?.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });

    await page.reload();
    await expectWiredCanvas(page);
    await page.getByRole('button', { name: 'Configure' }).click();
    await expect(page.getByRole('combobox', { name: 'Email' })).toHaveText('optional');
  });

  test('should keep each palette-added step inside the canvas when added below the lowest step', async ({
    page,
  }) => {
    await page.goto(draftUrl());
    await expectDraftLoaded(page);
    await addStepByClick(page, 'terminal');

    // Pressing the node low on its body keeps the click clear of the toolbar overlay.
    const lowest = stepNode(page, await findLowestStepId(page));
    const box = (await lowest.boundingBox())!;
    await lowest.click({
      position: { x: box.width * HALF, y: box.height - BODY_PRESS_FROM_BOTTOM },
    });

    for (let added = 0; added < STEPS_TO_OVERFLOW; added += 1) {
      const id = await addStepByClick(page, 'terminal');
      await expectNodeInsidePane(page, id);
    }
  });

  test('should delete a step with the key only while focus is on the canvas', async ({ page }) => {
    await page.goto(draftUrl());
    await expectDraftLoaded(page);
    const id = await addStepByClick(page, 'contact-details');

    await page.getByRole('combobox', { name: 'Target of success' }).focus();
    await page.keyboard.press('Backspace');
    await page.getByRole('button', { name: 'Validate' }).focus();
    await page.keyboard.press('Delete');
    expect(await readStepIds(page)).toContain(id);

    await clickNodeLowerLeft(stepNode(page, id));
    await page.keyboard.press('Delete');
    await expect.poll(() => readStepIds(page)).not.toContain(id);
  });

  test('should not pan the canvas when a step is dropped from the palette', async ({ page }) => {
    await page.goto(draftUrl());
    await expectDraftLoaded(page);
    let lastAdded = '';
    for (let added = 0; added < STEPS_TO_OVERFLOW; added += 1) {
      lastAdded = await addStepByClick(page, 'terminal');
      await expectNodeInsidePane(page, lastAdded);
    }

    // A pan moves every node on screen, so a step already there holding its place shows the view held still.
    const anchor = stepNode(page, lastAdded);
    const boxBefore = await readSettledBox(anchor);
    const idsBefore = await readStepIds(page);

    const pane = (await canvasPane(page).boundingBox())!;
    await page.getByRole('button', { name: /^contact-details / }).dragTo(canvasPane(page), {
      targetPosition: { x: pane.width * HALF, y: pane.height * HALF },
    });
    await expect.poll(async () => (await readStepIds(page)).length).toBe(idsBefore.length + 1);
    const droppedId = (await readStepIds(page)).find((id) => !idsBefore.includes(id))!;

    // A pan would start in the frame after the dropped step is selected and measured.
    await expect(page.getByRole('textbox', { name: 'Step name' })).toHaveValue(droppedId);
    await expect(stepNode(page, droppedId)).toBeVisible();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(JSON.stringify(await anchor.boundingBox())).toBe(boxBefore);
  });

  test('should save a consent tracked as an agreement from its step', async ({ page }) => {
    await page.goto(draftUrl());
    await expectDraftLoaded(page);
    const id = await addStepByClick(page, 'consents');

    await page.getByRole('checkbox', { name: 'Track termsAccepted as agreement' }).check();
    await expect(
      page.getByRole('textbox', { name: 'Agreement key for termsAccepted' }),
    ).toHaveValue('terms-accepted');

    await page.getByRole('button', { name: 'Workflow settings' }).click();
    await expect(page.getByRole('combobox', { name: 'Step of agreement 1' })).toHaveText(id);
    await expect(page.getByRole('combobox', { name: 'Field of agreement 1' })).toHaveText(
      'termsAccepted',
    );
    await page.getByRole('textbox', { name: 'Key of agreement 1' }).fill('Terms');
    await expect(page.getByRole('alert')).toHaveText('Use lowercase letters, digits and -');
    await page.getByRole('textbox', { name: 'Key of agreement 1' }).fill('eu-terms');
    await page.getByRole('button', { name: 'Close' }).click();
    await clickNodeLowerLeft(stepNode(page, id));
    await expect(
      page.getByRole('textbox', { name: 'Agreement key for termsAccepted' }),
    ).toHaveValue('eu-terms');

    const saveRequest = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().endsWith('/versions/1'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    const body = (await saveRequest).postDataJSON() as { agreements?: unknown };

    expect(body.agreements).toEqual([{ key: 'eu-terms', step: id, acceptedWhen: 'termsAccepted' }]);
  });
});
