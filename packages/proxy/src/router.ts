const ID_PATTERNS = [
  /^\d+$/, // 42
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[a-z]+_[A-Za-z0-9]*\d[A-Za-z0-9]*$/, // team_3, proj_a1 (must contain a digit)
  /^(?=.*\d)[A-Za-z0-9_-]{16,}$/, // long opaque ids (must contain a digit)
];

export const isIdSegment = (s: string) => ID_PATTERNS.some((re) => re.test(s));

/** `/api/teams/team_3?x=1` → `{ path: '/teams/team_3', pattern: '/teams/:id', params: { id: 'team_3' } }` */
export function normalisePath(rawPath: string) {
  const path = rawPath.split('?')[0].replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '') || '/';
  const params: Record<string, string> = {};
  let n = 0;
  const pattern = path
    .split('/')
    .map((seg) => {
      if (!seg || !isIdSegment(seg)) return seg;
      n++;
      const name = n === 1 ? 'id' : `id${n}`;
      params[name] = decodeURIComponent(seg);
      return `:${name}`;
    })
    .join('/');
  return { path, pattern, params };
}

export const routeKey = (method: string, pattern: string) => `${method.toUpperCase()} ${pattern}`;

export const isRead = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
