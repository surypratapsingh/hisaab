export type Result<T, E = Error> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly kind = 'ok' as const;

  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true;
  }

  isErr(): this is Err<T, E> {
    return false;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value);
  }

  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  getOrThrow(): T {
    return this.value;
  }

  getOrNull(): T | null {
    return this.value;
  }

  getOrElse(_fallback: T): T {
    return this.value;
  }
}

export class Err<T, E> {
  readonly kind = 'err' as const;

  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false;
  }

  isErr(): this is Err<T, E> {
    return true;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error);
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }

  flatMap<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return new Err(this.error);
  }

  getOrThrow(message?: string): never {
    if (this.error instanceof Error) {
      throw this.error;
    }
    throw new Error(message ?? String(this.error));
  }

  getOrNull(): null {
    return null;
  }

  getOrElse(fallback: T): T {
    return fallback;
  }
}

export const ok = <T, E = never>(value: T): Result<T, E> => new Ok(value);

export const err = <E, T = never>(error: E): Result<T, E> => new Err(error);

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T, E> =>
  result.kind === 'ok';

export const isErr = <T, E>(result: Result<T, E>): result is Err<T, E> =>
  result.kind === 'err';
