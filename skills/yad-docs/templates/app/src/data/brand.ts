// The brand the site shows in its top bar. `yad docs brand <site>` rewrites this file from the Product's
// .sdlc/brand.json: `name` is the brand's name, and `mark` its mark (or logo) as a data: image. With
// `mark: null` the top bar shows yadflow's icon.
export const brand: { name: string; mark: string | null } = { name: 'yadflow', mark: null };
