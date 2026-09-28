"use client";

import { Fragment, type ReactNode } from "react";

/**
 * The little markdown the assistant is allowed (lib/server/chat/system-prompt
 * rule 7): paragraphs, bullet and numbered lists, bold, and links. Nothing
 * else renders, images least of all: an image URL is a way to send what the
 * page knows to someone else's server. A link shows its host beside its
 * words and opens in a new tab, and only http and https links are links.
 */

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
    } else if (last && last.kind === "p") {
      last.lines.push(line.replace(/^#{1,6}\s+/, ""));
    } else {
      blocks.push({ kind: "p", lines: [line.replace(/^#{1,6}\s+/, "")] });
    }
  }
  return blocks.filter((block) => (block.kind === "p" ? block.lines.length > 0 : block.items.length > 0));
}

function hostOf(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** Bold and links inside one line. Anything else stays literal text. */
export function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // ![alt](src) is caught first so an image never becomes a link either.
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s)]+)/g;
  let at = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > at) out.push(text.slice(at, match.index));
    const key = `${keyBase}-${n++}`;
    if (match[2] !== undefined) {
      // An image: its words only.
      if (match[1]) out.push(match[1]);
    } else if (match[4] !== undefined) {
      const host = hostOf(match[4]);
      out.push(host ? <ChatLink key={key} href={match[4]} label={match[3]} host={host} /> : match[3]);
    } else if (match[5] !== undefined) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {match[5]}
        </strong>,
      );
    } else if (match[6] !== undefined) {
      const host = hostOf(match[6]);
      out.push(host ? <ChatLink key={key} href={match[6]} label={host} host={null} /> : match[6]);
    }
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function ChatLink({ href, label, host }: { href: string; label: string; host: string | null }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
      {label}
      {host && label !== host ? <span className="text-muted-foreground"> ({host})</span> : null}
    </a>
  );
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        if (block.kind === "p") {
          return (
            <p key={key}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`${key}-${lineIndex}`}>
                  {lineIndex > 0 && <br />}
                  {inline(line, `${key}-${lineIndex}`)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind === "ul" ? "ul" : "ol";
        return (
          <List key={key} className={block.kind === "ul" ? "ml-4 list-disc space-y-1" : "ml-4 list-decimal space-y-1"}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`} className="pl-0.5">
                {inline(item, `${key}-${itemIndex}`)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
