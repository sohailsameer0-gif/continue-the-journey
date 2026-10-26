import { supabase } from '@/integrations/supabase/client';

const BUCKET_MARKER = '/payment-proofs/';

/**
 * Payment proofs live in a private storage bucket, so stored full URLs no
 * longer serve directly. Resolves either a stored public URL (deriving the
 * object path from it) or a bare object path into a short-lived signed URL.
 * Falls back to the original value when no path can be derived.
 */
export async function resolveProofUrl(pathOrUrl: string): Promise<string> {
  let path: string | null = null;
  const idx = pathOrUrl.indexOf(BUCKET_MARKER);
  if (idx !== -1) {
    path = pathOrUrl.slice(idx + BUCKET_MARKER.length).split('?')[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the raw path if it is not valid percent-encoding
    }
  } else if (!/^https?:\/\//i.test(pathOrUrl)) {
    path = pathOrUrl;
  }
  if (!path) return pathOrUrl;
  const { data } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? pathOrUrl;
}
