// Stands in for std/http `serve` so an edge function's handler can be mounted
// inside the local gateway instead of binding its own port.
type Handler = (req: Request) => Response | Promise<Response>;
export function serve(handler: Handler): void {
  (globalThis as unknown as { __edgeHandler?: Handler }).__edgeHandler = handler;
}
