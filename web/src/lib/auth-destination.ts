/** Only navigate to a path on this site after authentication. */
export function authDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/picks";
  return value;
}
