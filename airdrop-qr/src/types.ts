export type AirdropQrEntry = {
  slug: string;
  label: string;
  /** Absolute https URL shown under the QR and used as the QR destination base. */
  url: string;
  blurb?: string;
};

export type AirdropQrUtm = {
  source: string;
  medium: string;
  /** When true (default), utm_campaign is set to each entry's slug. */
  campaignFromSlug?: boolean;
};

export type GenerateKitOptions = {
  brand: string;
  outDir: string;
  entries: AirdropQrEntry[];
  accent?: string;
  background?: string;
  ink?: string;
  utm?: AirdropQrUtm;
  /** Index page heading. Defaults to "QR kit". */
  indexTitle?: string;
  /** Index page blurb under the title. */
  indexBlurb?: string;
};

export type CatalogFile = {
  brand: string;
  accent?: string;
  background?: string;
  ink?: string;
  utm?: AirdropQrUtm;
  indexTitle?: string;
  indexBlurb?: string;
  entries: AirdropQrEntry[];
};

export type Theme = {
  brand: string;
  accent: string;
  background: string;
  ink: string;
  muted: string;
};
