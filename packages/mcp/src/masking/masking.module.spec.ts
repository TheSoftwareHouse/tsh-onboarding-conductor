import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FieldClass } from './masking.constants';
import { FieldClassifier } from './field-classifier';
import { Masker } from './masker';
import { MaskingModule } from './masking.module';

describe('MaskingModule', () => {
  it('builds the classifier and masker from MCP_MASKING_PASS_FIELDS and MCP_MASKING_KEY', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ MCP_MASKING_KEY: 'k'.repeat(32), MCP_MASKING_PASS_FIELDS: 'region' })],
        }),
        MaskingModule,
      ],
    }).compile();

    const classes = moduleRef.get(FieldClassifier).classify({
      steps: [{ data: { region: { type: 'text' }, country: { type: 'text' } } }],
    });

    expect(classes.get('region')).toEqual({ class: FieldClass.PASS });
    expect(classes.get('country')).toEqual({ class: FieldClass.DROP });
    expect(
      moduleRef
        .get(Masker)
        .maskValue('a@b.co', { class: FieldClass.PSEUDONYMISE, format: 'email' }),
    ).toMatch(/^email:[0-9a-f]{12}$/);
  });
});
