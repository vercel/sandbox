export class NotOk extends Error {
  name = "NotOk";
  response: { statusCode: number; responseText: string };
  constructor(response: { statusCode: number; responseText: string }) {
    super(`HTTP ${response.statusCode}: ${response.responseText}`);
    this.response = response;
  }
}
