---
"sandbox": minor
---

Experiment with retaining local traces for error reports. Spans are written as OTLP/JSON lines to the XDG cache directory, with the 10 latest trace files retained for replay into Jaeger or Tempo. Trace names and attributes avoid command arguments, environment values, paths, and credentials.
