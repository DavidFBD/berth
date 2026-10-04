/**
 * X's post intent: a link that opens X's own composer with words and a
 * link filled in, which the person can change or close. Berth posts
 * nothing, calls no X API and rewards nothing for it (X's developer policy
 * forbids paying for a post, and Berth never pays for any X action).
 */
export const X_POST_INTENT = "https://x.com/intent/post";

export function xPostIntent(text: string, url: string): string {
  return `${X_POST_INTENT}?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * The invite post's words: the calm line, and while an invite campaign is
 * live, or whether one is live is not known yet, the disclosure that the
 * inviter may be paid. Only a known "no campaign" leaves it off.
 */
export function inviteXWords(copy: { inviteXText: string; inviteXDisclosure: string }, campaignLive: boolean | undefined): string {
  return campaignLive === false ? copy.inviteXText : `${copy.inviteXText} ${copy.inviteXDisclosure}`;
}
