/**
 * Shows a failed load. If earlier data is still on screen (a background refresh failed),
 * it only adds a quiet note instead of a red error over a list that's still fine.
 */
export function QueryError({ error, hasData }: { error: Error | null; hasData: boolean }) {
  if (!error) return null;
  if (hasData) {
    return (
      <p className="muted small stale-note" role="status">
        Couldn't refresh just now. Showing what was loaded before.
      </p>
    );
  }
  return <p className="form-error">{error.message}</p>;
}
