// Deployment-relative links to the sibling sites on the same Pages domain.
// The terminology report is published at the Pages root, one level above the
// tutorial's base path (e.g. /yadflow/tutorial/ -> /yadflow/). Deriving it from
// the build-time base keeps local, preview, and fork builds pointed at their
// own origin instead of the canonical production URL.
const base = import.meta.env.BASE_URL || '/';

/** The terminology & workflow report (the Pages root). */
export const REFERENCE_URL = new URL('..', new URL(base, 'http://_local_')).pathname;

/** The canonical source repository (not deployment-relative). */
export const REPO_URL = 'https://github.com/abdelrahmannasr/yadflow';
