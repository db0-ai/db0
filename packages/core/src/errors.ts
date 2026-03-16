/**
 * Thrown when a supersede operation fails due to version conflict.
 * This happens when the target memory was already superseded by another process.
 */
export class VersionConflictError extends Error {
  constructor(
    public readonly memoryId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion?: number,
  ) {
    super(
      `Version conflict on memory ${memoryId}: expected version ${expectedVersion}` +
        (actualVersion !== undefined ? `, got ${actualVersion}` : `, memory already superseded`),
    );
    this.name = "VersionConflictError";
  }
}
