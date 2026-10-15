import { BnplSessionStore } from '../bnpl/bnpl-session.store';
import { StateWaiter } from '../bnpl/state-waiter';
import { EngineWebhookController } from './engine-webhook.controller';

describe('EngineWebhookController', () => {
  let store: BnplSessionStore;
  let waiter: { wake: jest.Mock };
  let controller: EngineWebhookController;
  const body = { event: { type: 'onboarding.state_changed' }, onboarding: { id: 'o1' } };

  beforeEach(() => {
    store = new BnplSessionStore();
    waiter = { wake: jest.fn() };
    controller = new EngineWebhookController(store, waiter as unknown as StateWaiter);
    store.create('o1', 'p');
  });

  it('wakes the waiter of the session that owns the onboarding', () => {
    controller.receive('e1', body);

    expect(waiter.wake).toHaveBeenCalledWith('o1');
    expect(store.findByOnboardingId('o1')?.lastEventId).toBe('e1');
  });

  it('ignores a redelivery of the same event id', () => {
    controller.receive('e1', body);
    controller.receive('e1', body);

    expect(waiter.wake).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an unknown onboarding', () => {
    expect(() => controller.receive('e2', { onboarding: { id: 'someone-else' } })).not.toThrow();
    expect(waiter.wake).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'text', {}, { onboarding: {} }, { onboarding: { id: 7 } }])(
    'tolerates an unusable body %p',
    (unusable) => {
      expect(() => controller.receive('e3', unusable)).not.toThrow();
      expect(waiter.wake).not.toHaveBeenCalled();
    },
  );

  it('still wakes when the event id header is missing', () => {
    controller.receive(undefined, body);

    expect(waiter.wake).toHaveBeenCalledWith('o1');
  });
});
