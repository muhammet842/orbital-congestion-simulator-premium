/**
 * Self-hosted web fonts (Fontsource, SIL OFL 1.1).
 *
 * Replaces the Google Fonts <link> so visitors' browsers make no third-party
 * requests (privacy) and the CSP can restrict fonts to our own origin.
 *
 * The per-weight files declare each script subset (latin, latin-ext for
 * Turkish, cyrillic for Russian, ...) with a unicode-range, so the browser
 * downloads only the subsets a page actually uses.
 */
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/syne/600.css';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
