/**
 * Decode a Base64 URL-encoded string into a JSON object.
 *
 * @param base64Url - The Base64 URL-encoded string to decode.
 * @returns The decoded JSON object or null if decoding fails.
 */
export function decodeBase64Url(base64Url: string) {
  return JSON.parse(
    Buffer.from(
      base64Url.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8"),
  );
}
