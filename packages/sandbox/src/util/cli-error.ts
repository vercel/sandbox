export class CliError extends Error {
  constructor(
    message: string,
    readonly options: {
      reason?: string;
      exitCode?: number;
    } = {},
  ) {
    super(message);
  }

  get exitCode() {
    return this.options.exitCode ?? 2;
  }
}
