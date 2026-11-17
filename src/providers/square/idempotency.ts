/** Square refuses idempotency keys over 45 characters (and an empty one). */
export const SQUARE_KEY_MAX = 45

/** The key, or an error before anything is sent to Square. */
export function checkSquareKey(key: string | undefined): string {
  if (!key) throw new Error('A Square charge or refund needs its own idempotency key; nothing was sent')
  if (key.length > SQUARE_KEY_MAX) throw new Error(`Square idempotency key is ${key.length} characters; Square allows ${SQUARE_KEY_MAX}. Nothing was sent`)
  return key
}
