import { STEP_TYPE } from './step-type-names';
import { listStepTypes } from './step-type.registry';

describe('STEP_TYPE', () => {
  it('names exactly the step types the registry lists', () => {
    expect([...Object.values(STEP_TYPE)].sort()).toEqual(
      listStepTypes()
        .map((definition) => definition.type)
        .sort(),
    );
  });
});
