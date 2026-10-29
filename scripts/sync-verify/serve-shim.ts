// Stands in for https://deno.land/std@0.168.0/http/server.ts, which the
// sandbox cannot fetch: the same serve(handler) on port 8000, via Deno.serve.
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  Deno.serve({ hostname: "127.0.0.1", port: 8000, onListen: () => {} }, handler);
}
