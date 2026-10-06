import { Paise, paise, sum } from '@/money/money';
import { Id, generateId } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';

export type PostingInput = {
  accountId: Id;
  amount: Paise;
};

export type PostingWithId = PostingInput & {
  id: Id;
};

export type PostingValidationError = {
  code: 'UNBALANCED' | 'INSUFFICIENT_POSTINGS' | 'INVALID_AMOUNT';
  message: string;
};

export const createPostings = (
  inputs: PostingInput[]
): Result<PostingWithId[], PostingValidationError> => {
  if (inputs.length < 2) {
    return err({
      code: 'INSUFFICIENT_POSTINGS',
      message: 'Must have at least 2 postings per entry',
    });
  }

  const total = sum(inputs.map((p) => p.amount));

  if (total !== paise(0)) {
    return err({
      code: 'UNBALANCED',
      message: `Postings do not balance. Total: ${total}`,
    });
  }

  return ok(inputs.map((p) => ({ ...p, id: generateId() })));
};

export const validateBalance = (postings: PostingWithId[]): boolean =>
  sum(postings.map((p) => p.amount)) === paise(0);
