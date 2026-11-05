export class CliError extends Error {
  constructor(
    message: string,
    readonly options: {
      reason?: string;
      exitCode?: number;
      json?: boolean;
      data?: unknown;
      userActionRequired?: boolean;
    } = {},
  ) {
    super(message);
  }

  get exitCode() {
    return this.options.exitCode ?? 2;
  }

  writeJson() {
    process.stderr.write(
      JSON.stringify({
        status: this.exitCode === 2 ? "action_required" : "error",
        reason: this.options.reason ?? "invalid_arguments",
        message: this.message,
        ...(this.options.data ? { data: this.options.data } : {}),
        ...(this.options.userActionRequired
          ? { userActionRequired: true }
          : {}),
      }) + "\n",
    );
  }
}
