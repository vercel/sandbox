export async function updateStatus(
  stream: WritableStream<string>,
  phase: string,
  attempt: number,
) {
  "use step";
  const writer = stream.getWriter();
  await writer.write(JSON.stringify({ phase, attempt }));
  writer.releaseLock();
}
