/**
 * The cursive faces offered by the "Type" tab of the signature dialog.
 *
 * The viewer loads these from Google Fonts by default. Left to that, the tab
 * disappears entirely on a machine with no connection — it is dropped rather
 * than falling back to a system cursive — so the faces are bundled instead.
 *
 * The files and the stylesheet live in `public/fonts/`, refreshed by
 * `scripts/sync-signature-fonts.mjs` from the `@fontsource/*` packages. They
 * are not imported through Vite because the viewer wants a *stylesheet URL*,
 * and the stylesheet references the font files relatively: both need stable,
 * unhashed names. All four are SIL Open Font License 1.1.
 */

/** Families in `public/fonts/signature-fonts.css`, in the order the picker shows them. */
export const SIGNATURE_FONT_FAMILIES = ['Caveat', 'Dancing Script', 'Great Vibes', 'Pacifico'] as const;

export const SIGNATURE_FONTS = {
  stylesheetUrl: '/fonts/signature-fonts.css',
  fonts: SIGNATURE_FONT_FAMILIES.map((family) => ({ name: family, family })),
};
