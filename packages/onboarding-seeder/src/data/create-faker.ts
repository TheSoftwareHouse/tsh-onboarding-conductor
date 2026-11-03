import { Faker, base, en } from '@faker-js/faker';

/** A faker with English names and addresses, seeded: the same `seed` gives the same values. */
export function createFaker(seed: number): Faker {
  const faker = new Faker({ locale: [en, base] });
  faker.seed(seed);

  return faker;
}
