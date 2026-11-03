import type { paths } from '@tsh/openapi';
import { MILLISECONDS_PER_SECOND } from '../time.constants';

/** Sized for a submit that runs a connector chain inline, as the public API contract advises. */
const ENGINE_REQUEST_TIMEOUT_MS = 60 * MILLISECONDS_PER_SECOND;

const HTTP_NO_CONTENT = 204;

type Method = 'get' | 'post';
type PathsFor<M extends Method> = {
  [P in keyof paths]: paths[P][M] extends undefined ? never : P;
}[keyof paths];
type OperationOf<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;

type PathParamsOf<O> = O extends { parameters: { path: infer X } } ? X : never;
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : never;
type JsonContent<R> = R extends { content: { 'application/json': infer B } } ? B : never;
type ResponseOf<O> = O extends { responses: infer R }
  ? JsonContent<R[Extract<keyof R, 200 | 201>]>
  : never;

type Slot<K extends string, V> = [V] extends [never] ? { [P in K]?: never } : { [P in K]: V };

/** The path parameters and body an operation declares; a part it lacks is not accepted. */
export type EngineRequest<O> = Slot<'path', PathParamsOf<O>> & Slot<'body', BodyOf<O>>;

/** The request is optional exactly when the operation declares nothing required. */
type RequestArgs<O> =
  Record<never, never> extends EngineRequest<O>
    ? [request?: EngineRequest<O>]
    : [request: EngineRequest<O>];

interface UntypedRequest {
  path?: Record<string, unknown>;
  body?: unknown;
}

/** The body a provider posts to `POST /v1/webhooks/{providerKey}/callback`; the document types it as a raw string. */
export interface ProviderCallback {
  providerReference: string;
  status: 'accepted' | 'rejected' | 'invalid' | 'invalid-data';
  reason?: string;
  submittedData: Record<string, unknown>;
}

/** A non-2xx answer from the engine: the status and, when the body carried one, its `code`. */
export class EngineError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly body: string,
  ) {
    super(`${method} ${url} answered ${status}${code ? ` ${code}` : ''}: ${body}`);
  }
}

/** The engine's public onboarding API over HTTP, typed from its OpenAPI document. */
export class EngineClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<M extends Method, P extends PathsFor<M>>(
    method: M,
    path: P,
    ...args: RequestArgs<OperationOf<P, M>>
  ): Promise<ResponseOf<OperationOf<P, M>>> {
    const request = (args[0] ?? {}) as UntypedRequest;
    const url = `${this.baseUrl}${path.replace(/\{(\w+)\}/g, (_, name: string) =>
      encodeURIComponent(String(request.path?.[name])),
    )}`;
    const response = await this.send(method.toUpperCase(), url, request.body);
    const text = await response.text();

    if (response.status === HTTP_NO_CONTENT || text === '') {
      return undefined as ResponseOf<OperationOf<P, M>>;
    }

    return JSON.parse(text) as ResponseOf<OperationOf<P, M>>;
  }

  async postProviderCallback(providerKey: string, callback: ProviderCallback): Promise<void> {
    await this.send(
      'POST',
      `${this.baseUrl}/v1/webhooks/${encodeURIComponent(providerKey)}/callback`,
      callback,
    );
  }

  private async send(method: string, url: string, body: unknown): Promise<Response> {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ENGINE_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EngineError(method, url, response.status, parseErrorCode(text), text);
    }

    return response;
  }
}

function parseErrorCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    const code = (parsed as { code?: unknown } | null)?.code;

    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}
