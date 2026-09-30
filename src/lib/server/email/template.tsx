import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
import { COPY } from "@/lib/copy";
import type { EmailContent } from "@/lib/server/email/compose";

/**
 * The one layout every Berth email wears, in the Seline dress of the app:
 * a warm stone canvas, one white card with one hairline, the mark in the
 * header, an Inter Tight heading, Inter for sentences, Plex Mono for
 * numbers, and one pill button, the only place the Berth blue appears.
 * No web fonts are fetched (a font host would learn who opened it): the
 * faces are named first and fall back to the system's own.
 */

const INK = "#1C1917";
const INK_2 = "#44403C";
const MUTED = "#6F6964";
const CANVAS = "#F7F6F4";
const CARD = "#FFFFFF";
const CARD_2 = "#F2F1EE";
const LINE = "#E8E6E5";
const ACCENT = "#1F4ED8";

const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Inter Tight', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export type LayoutProps = {
  content: EmailContent;
  markUrl: string;
  /** The one click unsubscribe page, for every kind but security. */
  unsubscribeUrl: string | null;
  /** The support address (EMAIL_REPLY_TO), for a security notice's "Not you?" line. */
  contact: string;
};

export function NoticeEmail({ content, markUrl, unsubscribeUrl, contact }: LayoutProps) {
  const text = { fontFamily: SANS, fontSize: "15px", lineHeight: "24px", color: INK_2, margin: "0 0 14px" };
  const small = { fontFamily: SANS, fontSize: "13px", lineHeight: "20px", color: MUTED, margin: "0 0 8px" };
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{content.preview}</Preview>
      <Body style={{ backgroundColor: CANVAS, margin: 0, padding: "32px 0" }}>
        <Container style={{ maxWidth: "520px", width: "100%", margin: "0 auto", padding: "0 16px" }}>
          <Section style={{ padding: "0 4px 16px" }}>
            <Img src={markUrl} width="96" height="48" alt="Berth" style={{ display: "block", border: 0 }} />
          </Section>
          <Section
            style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, borderRadius: "12px", padding: "28px 24px 24px" }}
          >
            <Heading
              as="h1"
              style={{
                fontFamily: DISPLAY,
                fontWeight: 400,
                fontSize: "24px",
                lineHeight: "30px",
                letterSpacing: "-0.02em",
                color: INK,
                margin: "0 0 16px",
              }}
            >
              {content.heading}
            </Heading>
            {content.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={text}>
                {paragraph}
              </Text>
            ))}
            {content.list && content.list.length > 0 ? (
              <ul style={{ margin: "0 0 14px", paddingLeft: "20px" }}>
                {content.list.map((item) => (
                  <li key={item} style={{ ...text, margin: "0 0 6px" }}>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            {content.sections?.map((section) => (
              <Section key={section.heading} style={{ margin: "4px 0 18px" }}>
                <Text
                  style={{
                    fontFamily: SANS,
                    fontSize: "11.5px",
                    lineHeight: "16px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: MUTED,
                    margin: "0 0 6px",
                  }}
                >
                  {section.heading}
                </Text>
                <Section style={{ backgroundColor: CARD_2, borderRadius: "10px", padding: "8px 16px" }}>
                  {section.facts.map((fact) => (
                    <Row key={fact.label}>
                      <Column style={{ ...small, margin: 0, padding: "5px 12px 5px 0", color: INK_2, verticalAlign: "top" }}>
                        {fact.label}
                      </Column>
                      <Column
                        align="right"
                        style={{
                          fontFamily: MONO,
                          fontSize: "14px",
                          lineHeight: "20px",
                          color: INK,
                          padding: "5px 0",
                          verticalAlign: "top",
                          // Kept to one line only beside a move, where the words are a number.
                          ...(section.facts.some((entry) => entry.aside) ? { whiteSpace: "nowrap" as const } : {}),
                        }}
                      >
                        {fact.value}
                      </Column>
                      {section.facts.some((entry) => entry.aside) ? (
                        <Column
                          align="right"
                          style={{
                            fontFamily: MONO,
                            fontSize: "13px",
                            lineHeight: "20px",
                            color: MUTED,
                            padding: "5px 0 5px 12px",
                            verticalAlign: "top",
                            whiteSpace: "nowrap",
                            width: "72px",
                          }}
                        >
                          {fact.aside ?? ""}
                        </Column>
                      ) : null}
                    </Row>
                  ))}
                </Section>
                {section.note ? <Text style={{ ...small, margin: "6px 0 0" }}>{section.note}</Text> : null}
              </Section>
            ))}
            {content.after?.map((paragraph) => (
              <Text key={paragraph} style={text}>
                {paragraph}
              </Text>
            ))}
            {content.facts && content.facts.length > 0 ? (
              <Section style={{ backgroundColor: CARD_2, borderRadius: "10px", padding: "12px 16px", margin: "4px 0 18px" }}>
                {content.facts.map((fact) => (
                  <Text key={fact.label} style={{ ...small, margin: "4px 0", color: MUTED }}>
                    {fact.label}
                    {"  "}
                    <span style={{ fontFamily: MONO, fontSize: "14px", color: INK }}>{fact.value}</span>
                  </Text>
                ))}
              </Section>
            ) : null}
            <Button
              href={content.button.href}
              style={{
                backgroundColor: ACCENT,
                color: "#FFFFFF",
                fontFamily: SANS,
                fontSize: "15px",
                fontWeight: 600,
                lineHeight: "20px",
                borderRadius: "999px",
                padding: "11px 22px",
                textDecoration: "none",
                display: "inline-block",
                margin: "6px 0 0",
              }}
            >
              {content.button.label}
            </Button>
          </Section>
          <Section style={{ padding: "18px 4px 0" }}>
            <Text style={small}>{content.why}</Text>
            {content.kind === "security" ? (
              <Text style={small}>
                {COPY.email.notYou}{" "}
                <Link href={`mailto:${contact}`} style={{ color: INK, textDecoration: "underline" }}>
                  {contact}
                </Link>
                .
              </Text>
            ) : unsubscribeUrl ? (
              <Text style={small}>
                <Link href={unsubscribeUrl} style={{ color: INK, textDecoration: "underline" }}>
                  {COPY.email.unsubscribe}
                </Link>
              </Text>
            ) : null}
            <Hr style={{ borderColor: LINE, margin: "14px 0 10px" }} />
            <Text style={{ ...small, fontSize: "12px" }}>{COPY.email.signoff}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** The plain text part: the same words, in the same order. */
export function noticeText({ content, unsubscribeUrl, contact }: Omit<LayoutProps, "markUrl">): string {
  const lines: string[] = [content.heading, "", ...content.paragraphs];
  if (content.list?.length) lines.push("", ...content.list.map((item) => `* ${item}`));
  for (const section of content.sections ?? []) {
    lines.push("", section.heading, ...section.facts.map((fact) => `${fact.label}: ${fact.value}${fact.aside ? `, ${fact.aside}` : ""}`));
    if (section.note) lines.push(section.note);
  }
  if (content.after?.length) lines.push("", ...content.after);
  if (content.facts?.length) lines.push("", ...content.facts.map((fact) => `${fact.label}: ${fact.value}`));
  lines.push("", `${content.button.label}: ${content.button.href}`, "", content.why);
  if (content.kind === "security") lines.push(`${COPY.email.notYou} ${contact}.`);
  else if (unsubscribeUrl) lines.push(`${COPY.email.unsubscribe}: ${unsubscribeUrl}`);
  lines.push("", COPY.email.signoff);
  return lines.join("\n");
}
