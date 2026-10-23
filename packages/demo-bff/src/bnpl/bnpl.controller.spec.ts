import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { BnplController } from './bnpl.controller';
import { BnplService } from './bnpl.service';
import { PersonaService, PersonaSummary } from '../personas/persona.service';

const UK_SERVICE = { journeyOf: () => 'uk-algoan' } as unknown as BnplService;

describe('BnplController', () => {
  it('lists the personae through GET /v1/bnpl/personas', () => {
    const summaries: PersonaSummary[] = [
      {
        id: 'sherlock_holmes',
        name: 'Sherlock Holmes',
        story: 'story',
        expectedBand: 'approved',
        expectedScore: 965,
        profile: 'high',
        profileLabel: 'High score',
      },
    ];
    const personas = { list: jest.fn().mockReturnValue(summaries) };
    const controller = new BnplController(
      UK_SERVICE,
      personas as unknown as PersonaService,
      {} as ConfigService<AppConfig, true>,
    );

    expect(controller.listPersonas()).toBe(summaries);
    expect(controller.journey()).toEqual({ journey: 'uk-algoan' });
    expect(Reflect.getMetadata('path', BnplController.prototype.journey)).toBe('journey');
    expect(Reflect.getMetadata('path', BnplController)).toBe('v1/bnpl');
    expect(Reflect.getMetadata('path', BnplController.prototype.listPersonas)).toBe('personas');
  });

  it('forwards the bank login body to the service on POST sessions/:token/bank-login', async () => {
    const bankLogin = jest.fn().mockResolvedValue({ phase: 'collect' });
    const controller = new BnplController(
      { bankLogin } as unknown as BnplService,
      {} as PersonaService,
      {} as ConfigService<AppConfig, true>,
    );

    await expect(
      controller.bankLogin('tok', { persona: 'james_watson', method: 'qr' }),
    ).resolves.toEqual({ phase: 'collect' });
    expect(bankLogin).toHaveBeenCalledWith('tok', 'james_watson', 'qr');
    expect(Reflect.getMetadata('path', BnplController.prototype.bankLogin)).toBe(
      'sessions/:token/bank-login',
    );
  });

  it('lists no personae and forwards the bank link on the KSA journey', async () => {
    const bankLink = jest.fn().mockResolvedValue({ customerId: 'c1' });
    const controller = new BnplController(
      { journeyOf: () => 'ksa-lean-algoan', bankLink } as unknown as BnplService,
      { list: jest.fn().mockReturnValue([{ id: 'sherlock_holmes' }]) } as unknown as PersonaService,
      {} as ConfigService<AppConfig, true>,
    );

    expect(controller.listPersonas()).toEqual([]);
    await expect(controller.bankLink('tok')).resolves.toEqual({ customerId: 'c1' });
    expect(bankLink).toHaveBeenCalledWith('tok');
    expect(Reflect.getMetadata('path', BnplController.prototype.bankLink)).toBe(
      'sessions/:token/bank-link',
    );
  });

  describe('GET /v1/bnpl/sessions/:token/onboarding', () => {
    const controllerFor = (nodeEnv: string) =>
      new BnplController(
        { onboardingIdOf: jest.fn().mockReturnValue('o1') } as unknown as BnplService,
        {} as PersonaService,
        { get: () => nodeEnv } as unknown as ConfigService<AppConfig, true>,
      );

    it('returns the onboarding id under NODE_ENV=test', () => {
      expect(controllerFor('test').onboarding('tok')).toEqual({ onboardingId: 'o1' });
    });

    it.each(['development', 'production'])('answers SESSION_NOT_FOUND under %s', (nodeEnv) => {
      expect(() => controllerFor(nodeEnv).onboarding('tok')).toThrow(
        expect.objectContaining({
          response: { code: 'SESSION_NOT_FOUND', message: 'SESSION_NOT_FOUND' },
        }),
      );
    });
  });
});
