import type {
  Db0Backend,
  StateCheckpoint,
  StateCheckpointOpts,
} from "../types.js";

export class State {
  constructor(
    private backend: Db0Backend,
    private agentId: string,
    private sessionId: string,
  ) {}

  async checkpoint(opts: StateCheckpointOpts): Promise<StateCheckpoint> {
    return this.backend.stateCheckpoint(this.agentId, this.sessionId, opts);
  }

  async restore(): Promise<StateCheckpoint | null> {
    return this.backend.stateRestore(this.agentId, this.sessionId);
  }

  async list(): Promise<StateCheckpoint[]> {
    return this.backend.stateList(this.agentId, this.sessionId);
  }

  /** Get a specific checkpoint by ID. */
  async getCheckpoint(id: string): Promise<StateCheckpoint | null> {
    return this.backend.stateGetCheckpoint(id);
  }

  /**
   * Create a branch from an existing checkpoint.
   * Returns the new checkpoint that starts the branch.
   */
  async branch(
    fromCheckpointId: string,
    opts: Omit<StateCheckpointOpts, "parentCheckpointId">,
  ): Promise<StateCheckpoint> {
    return this.backend.stateCheckpoint(this.agentId, this.sessionId, {
      ...opts,
      parentCheckpointId: fromCheckpointId,
    });
  }
}
