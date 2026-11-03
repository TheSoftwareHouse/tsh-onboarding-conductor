/** A failure whose message is written for the model to read and act on. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
