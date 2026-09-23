# Branding assets

`india-post-logo.png` is a PLACEHOLDER (a plain envelope mark in the app's own postal-red), not the official India
Post emblem. Replace it with the real, authorized India Post logo before this app is branded for production use.

Requirements for the replacement file:

- Same filename and path (`assets/branding/india-post-logo.png`) so no code change is needed.
- Transparent-background PNG, roughly square (the badge that displays it is round/rounded-square).
- At least 256x256px (512x512 recommended) so it stays crisp at the sizes it's shown (the Login badge is ~64x64,
  the header mark is ~22-28px).

`BrandMark` (`src/components/common/BrandMark.tsx`) renders this file and falls back to the app's generic package
icon if the image fails to load, so a corrupt or missing replacement degrades gracefully instead of showing a
broken image.
