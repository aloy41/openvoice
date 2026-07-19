/**
 * Safe inline message rendering: autolinks URLs and applies **bold**,
 * *italic*, and `code`. Everything is rendered as React text nodes and
 * elements — NEVER via innerHTML/dangerouslySetInnerHTML — so message
 * content can never inject markup or script (XSS is a direct threat to the
 * device keys held in this origin; see the threat model).
 */
import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<]+)/g;

function renderInlineMarkup(text: string, keyBase: string): ReactNode[] {
  // One combined pass over `code`, **bold**, *italic*. Order matters: code
  // first so markers inside code are left literal.
  const tokenRe = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-slate-800 px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyBase}-i${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(...renderInlineMarkup(text.slice(last, m.index), `t${i}`));
    const url = m[0];
    nodes.push(
      <a
        key={`u${i}`}
        href={url}
        target="_blank"
        rel="noreferrer noopener nofollow"
        className="text-sky-400 underline hover:text-sky-300"
      >
        {url}
      </a>,
    );
    last = m.index + url.length;
    i++;
  }
  if (last < text.length) nodes.push(...renderInlineMarkup(text.slice(last), `t${i}`));
  return <>{nodes}</>;
}
