import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { BnplController } from './bnpl.controller';
import { BnplService } from './bnpl.service';
import { PersonaService, PersonaSummary } from '../personas/persona.service';

describe('BnplController', () => {
  it('lists the personae through GET /v1/bnpl/personas', () => {
    const summaries: PersonaSummary[] = [
      {
        id: 'sherlock_holmes',
        name: 'Sherlock Holmes',
        story: 'story',
        expectedBand: 'approved',
        expectedScore: 965,
      },
    ];
    const personas = { list: jest.fn().mockReturnValue(summaries) };
    const controller = new BnplController(
      {} as BnplService,
      personas as unknown as PersonaService,
      {} as ConfigService<AppConfig, true>,
    );

    expect(controller.listPersonas()).toBe(summaries);
    expect(Reflect.getMetadata('path', BnplController)).toBe('v1/bnpl');
    expect(Reflect.getMetadata('path', BnplController.prototype.listPersonas)).toBe('personas');
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
