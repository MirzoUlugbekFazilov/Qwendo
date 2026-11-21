export type QwendoEvent = {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string | null;
  is_online: boolean;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  is_free: boolean;
  organizer: string | null;
  categories: string[];
  tags: string[];
  popularity: number;
  score?: number | null;
  similarity?: number | null;
  distance_km?: number | null;
  reason?: string | null;
};

export type EventList = {
  items: QwendoEvent[];
  count: number;
  limit: number;
  offset: number;
  personalized: boolean;
  fallback: string | null;
};

export type CatalogueStats = {
  events: number;
  sources: number;
  cities: number;
  interests: number;
  last_updated: string | null;
};

export type Interest = {
  slug: string;
  label: string;
  category: string;
  sort_order: number;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  radius_km: number;
  include_online: boolean;
  interest_text: string | null;
  onboarded: boolean;
  digest_opt_in: boolean;
};

export type Me = {
  profile: Profile;
  interests: string[];
};
