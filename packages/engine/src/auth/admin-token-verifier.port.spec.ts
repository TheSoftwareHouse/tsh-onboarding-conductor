import {
  AdminTokenVerificationError,
  AdminTokenVerifierUnavailableError,
} from './admin-token-verifier.port';

/**
 * The guard branches on these two types to choose between 401 and 503, so their identity is load
 * bearing rather than decorative: a subclass that lost its prototype chain would silently turn
 * every outage into a rejected credential.
 */
describe('admin token verifier errors', () => {
  it.each([
    [AdminTokenVerificationError, 'AdminTokenVerificationError'],
    [AdminTokenVerifierUnavailableError, 'AdminTokenVerifierUnavailableError'],
  ])('names %p so a log or a serialized error still identifies it', (ErrorClass, expectedName) => {
    const error = new ErrorClass('something went wrong');

    expect(error.name).toBe(expectedName);
    expect(error.message).toBe('something went wrong');
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps the two distinguishable, which is the whole 401 versus 503 decision', () => {
    expect(new AdminTokenVerificationError('bad token')).not.toBeInstanceOf(
      AdminTokenVerifierUnavailableError,
    );
    expect(new AdminTokenVerifierUnavailableError('timeout')).not.toBeInstanceOf(
      AdminTokenVerificationError,
    );
  });
});
