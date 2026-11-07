/** The API's error shape: `{ error: { code, message, fix } }` with a 4xx status. */
export function apiError(status: number, code: string, message: string, fix: string): Response {
  return Response.json({ error: { code, message, fix } }, { status });
}
