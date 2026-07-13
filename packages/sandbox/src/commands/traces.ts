import * as cmd from "cmd-ts";
import { getTracesPath } from "../otel";

export const traces = cmd.command({
  name: "traces",
  args: {},
  async handler() {
    console.log(getTracesPath());
  },
});
