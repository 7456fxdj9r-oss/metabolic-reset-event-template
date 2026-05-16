// Parse a user-provided video URL into something the deck can render.
// Vimeo + YouTube get their player iframes; anything else (including
// direct Supabase Storage file URLs) is treated as a raw video file.
//
// The deck uses this to decide between <iframe> and <video> rendering,
// while the edit page can use it to validate a pasted link before
// saving.

export type VideoEmbed =
  | { type: 'iframe'; src: string; provider: 'vimeo' | 'youtube' }
  | { type: 'video'; src: string }
  | null;

export function parseVideoEmbed(url: string | null | undefined): VideoEmbed {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;

  // Vimeo:
  //   https://vimeo.com/123456789
  //   https://vimeo.com/123456789/h1234abc       (unlisted with privacy hash)
  //   https://www.vimeo.com/123456789
  //   https://player.vimeo.com/video/123456789
  //   https://player.vimeo.com/video/123456789?h=h1234abc
  const vimeoMatch = trimmed.match(
    /(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)(?:[/?](?:h=)?([\w-]+))?/i,
  );
  if (vimeoMatch) {
    const id = vimeoMatch[1];
    const hash = vimeoMatch[2];
    const src = hash
      ? `https://player.vimeo.com/video/${id}?h=${hash}`
      : `https://player.vimeo.com/video/${id}`;
    return { type: 'iframe', src, provider: 'vimeo' };
  }

  // YouTube:
  //   https://www.youtube.com/watch?v=ABC123
  //   https://youtu.be/ABC123
  //   https://www.youtube.com/embed/ABC123
  //   https://www.youtube.com/shorts/ABC123
  const ytMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/i,
  );
  if (ytMatch) {
    return {
      type: 'iframe',
      src: `https://www.youtube.com/embed/${ytMatch[1]}?rel=0`,
      provider: 'youtube',
    };
  }

  // Default: assume a raw video file URL (e.g., Supabase Storage).
  return { type: 'video', src: trimmed };
}

// Quick boolean check for whether the URL looks like an external
// embed (Vimeo / YouTube) vs. a raw file. Used by UI badges.
export function isExternalEmbed(url: string | null | undefined): boolean {
  const e = parseVideoEmbed(url);
  return e?.type === 'iframe';
}
