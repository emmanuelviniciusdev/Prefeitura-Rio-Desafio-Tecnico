export function isIgnoredHttpPath(url: string | undefined): boolean {
  const path = url?.split('?')[0] ?? '';
  return (
    path === '/' ||
    path === '/metrics' ||
    path === '/docs' ||
    path === '/docs-json' ||
    path.startsWith('/docs/')
  );
}
