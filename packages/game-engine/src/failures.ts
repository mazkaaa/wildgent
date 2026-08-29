import { Data } from "effect";
import type { FailureCode, GameFailureCode } from "./types";

/** A typed domain failure for callers that choose to run the engine as an Effect. */
export class GameFailure extends Data.TaggedError("GameFailure")<{
  readonly code: GameFailureCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}

/** Persistence errors are kept distinct so a UI can offer a clean reset. */
export class PersistenceFailure extends Data.TaggedError("PersistenceFailure")<{
  readonly code: "PERSISTENCE_FAILED" | "INCOMPATIBLE_SAVE";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const failure = (
  code: FailureCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
) => ({
  code,
  message,
  ...(details === undefined ? {} : { details }),
});
