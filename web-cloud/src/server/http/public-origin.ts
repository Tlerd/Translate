function firstHeaderValue(headers: Headers, name: string): string | undefined {
  return headers.get(name)?.split(',')[0].trim() || undefined;
}

function normalizedOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? undefined : origin;
  } catch { return undefined; }
}

/** Origin the browser used to reach this server, honoring reverse-proxy headers (Cloud Run, load balancers). */
export function publicOrigin(req: Request): string {
  try {
    const url = new URL(req.url);
    const forwardedProto = firstHeaderValue(req.headers, 'x-forwarded-proto')?.toLowerCase();
    const protocol = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : url.protocol.slice(0, -1);
    const host = firstHeaderValue(req.headers, 'x-forwarded-host') || firstHeaderValue(req.headers, 'host') || url.host;
    return new URL(`${protocol}://${host.toLowerCase()}`).origin;
  } catch { return new URL(req.url).origin; }
}

export function isAllowedOrigin(req: Request, origin: string): boolean {
  const candidate = normalizedOrigin(origin);
  if (!candidate) return false;
  if (candidate === publicOrigin(req)) return true;
  if (candidate === normalizedOrigin(process.env.AUTH_URL || process.env.NEXTAUTH_URL)) return true;
  return candidate === normalizedOrigin(req.url);
}
