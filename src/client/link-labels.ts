/** Describe a destination without treating every external page as an article. */
export function linkLabel(
  href: string,
  text: string,
  practice: boolean,
): string {
  if (practice) return "Practice";
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "Link";
  }
  const host = url.hostname.toLowerCase();
  const isHost = (domain: string) =>
    host === domain || host.endsWith(`.${domain}`);
  if (isHost("youtube.com") || isHost("youtu.be")) return "YouTube";
  if (url.protocol === "mailto:") return "Email";
  if (/\.pdf$/i.test(url.pathname)) return "PDF";
  if (/\bdemo\b/i.test(text) || /\/demo(?:s)?(?:\/|$)/i.test(url.pathname))
    return "Demo";
  if (isHost("github.com") || isHost("gitlab.com")) return "Code";
  if (
    host.startsWith("docs.") ||
    /\/(?:docs|documentation)(?:\/|$)/i.test(url.pathname)
  )
    return "Docs";
  if (
    /\b(?:article|blog|post|artykuł)\b/i.test(text) ||
    /\/(?:blog|articles?|posts?)(?:\/|$)/i.test(url.pathname) ||
    isHost("medium.com") ||
    isHost("substack.com") ||
    isHost("arxiv.org")
  )
    return "Article";
  return "Link";
}
