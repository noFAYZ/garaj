import type { MetadataRoute } from 'next';
import { SITE_URL } from '../site';

const PAGES = [
  ['', 'monthly', 1],
  ['/support', 'monthly', 0.6],
  ['/privacy', 'yearly', 0.4],
  ['/terms', 'yearly', 0.4],
  ['/delete-account', 'yearly', 0.3],
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  // ponytail: one date for every page; per-page dates when they start changing apart.
  const lastModified = new Date('2026-11-27');
  return PAGES.map(([path, changeFrequency, priority]) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
