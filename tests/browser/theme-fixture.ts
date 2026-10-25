/**
 * Host theme fixture for the isolated browser harness. The values mirror the
 * pinned DSH theme's design-platform tokens so the board renders against the
 * same colors the real host provides, in both appearances.
 */
export const themeFixture = String.raw`
body{
  background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);
}
:root{
  color-scheme:light;
  --color-background:rgb(255,255,255);
  --background-color:rgb(255,255,255);
  --dsw-static-blue-950:rgb(23,37,84);
  --dsw-static-deepseek-400:rgb(122,170,255);
  --dsw-static-deepseek-450:rgb(86,134,254);
  --dsw-static-deepseek-500:rgb(65,118,230);
  --dsw-static-neutral-bluish-00:rgb(255,255,255);
  --dsw-static-neutral-bluish-50:rgb(249,250,251);
  --dsw-static-neutral-bluish-400:rgb(173,178,184);
  --dsw-static-neutral-bluish-950:rgb(21,21,23);
  --dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);
  --dsw-alias-label-deep-diving:color-mix(in srgb,var(--dsw-static-deepseek-500) 70%,var(--dsw-static-blue-950));
  --dsw-alias-state-business-primary:var(--dsw-static-deepseek-500);
  --dsw-alias-label-primary:rgb(15,17,21);
  --dsw-alias-label-secondary:rgb(97,102,107);
  --dsw-alias-button-primary-fill:var(--dsw-static-neutral-bluish-950);
  --dsw-alias-button-primary-hover:rgb(31,31,35);
  --dsw-alias-label-primary-foreground:var(--dsw-static-neutral-bluish-00);
}
[data-ds-dark-theme]{
  color-scheme:dark;
  --color-background:rgb(21,21,23);
  --background-color:rgb(21,21,23);
  --dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950);
  --dsw-alias-label-deep-diving:color-mix(in srgb,var(--dsw-static-deepseek-450) 55%,var(--dsw-static-neutral-bluish-400));
  --dsw-alias-state-business-primary:var(--dsw-static-deepseek-400);
  --dsw-alias-label-primary:rgb(250,250,250);
  --dsw-alias-label-secondary:rgb(207,211,214);
  --dsw-alias-button-primary-fill:var(--dsw-static-neutral-bluish-50);
  --dsw-alias-button-primary-hover:var(--dsw-static-neutral-bluish-400);
  --dsw-alias-label-primary-foreground:var(--dsw-static-neutral-bluish-950);
}
`;
