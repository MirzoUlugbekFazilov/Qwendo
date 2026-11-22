export type DiscoveryInterest = {
  name: string;
  type: string;
  source: "explicit" | "inferred";
  confidence: number;
  related: string[];
  priority: "must" | "very" | "curious";
  source_text: string;
  confirmed: boolean;
};

export type RadarPreferences = {
  frequency: "immediate" | "daily" | "weekly";
  quiet_start?: string | null;
  quiet_end?: string | null;
  timezone: string;
};

export const defaultRadarPreferences: RadarPreferences = { frequency: "immediate", timezone: "UTC" };

export type DiscoveryProfile = {
  categories: string[];
  interests: DiscoveryInterest[];
  text: string;
  motivations: string[];
  formats: string[];
  city: string;
  radius: number;
  online: boolean;
  flexible_travel: boolean;
  budget: number | null;
  budget_strict: boolean;
  availability: string;
  availability_strict: boolean;
  notice: string;
  notice_strict: boolean;
  radar: string;
  radar_preferences?: RadarPreferences;
  notifications: { alerts: boolean; digest: boolean; tickets: boolean };
};

export const emptyProfile: DiscoveryProfile = {
  categories: [], interests: [], text: "", motivations: [], formats: [],
  city: "", radius: 25, online: false, flexible_travel: true,
  budget: null, budget_strict: false, availability: "Flexible", availability_strict: false,
  notice: "Any time", notice_strict: false, radar: "",
  notifications: { alerts: false, digest: false, tickets: false },
};

export const categories: Record<string, string> = {
  tech: "Technology & AI", film: "Films & fandoms", music: "Music & concerts",
  business: "Startups & business", gaming: "Gaming & esports", sports: "Sports & fitness",
  arts: "Arts & culture", food: "Food & drink", education: "Science & education",
  fashion: "Fashion & lifestyle", comedy: "Comedy & entertainment", wellness: "Wellness & community",
};

export const motivations = [
  "Have fun and make memories", "Meet like-minded people", "Make new friends", "Grow my professional network",
  "Learn new things", "Advance my career", "Meet favourite artists or creators", "Try something completely new",
];
export const formats = [
  "Conferences and talks", "Networking and meetups", "Workshops and classes", "Hackathons and competitions",
  "Concerts and live performances", "Conventions and fan gatherings", "Film screenings and premieres",
  "Exhibitions and pop-ups", "Community and social activities", "Surprise me",
];
export const availability = ["Weekdays", "Weekday evenings", "Weekends", "Flexible"];
export const notice = ["This week", "1–4 weeks", "More than a month", "Any time"];
export const notifications = {
  alerts: "Alert me when a great match comes up",
  digest: "Send me a weekly digest",
  tickets: "Notify me when tickets go on sale",
};
export const priorityLabels = { must: "Must not miss", very: "Very interested", curious: "Curious" };
export const steps = [
  ["Categories", "What makes you excited?", "Choose the things you'd love to explore. Pick as many as you like."],
  ["Interests", "What are you really into?", "Tell us your favourites. The more specific you are, the better your discoveries."],
  ["Experiences", "What would you love to get out of events?", "Choose the reasons you go and the kinds of events you enjoy."],
  ["Location", "Where should Qwendo discover events for you?", "Set a home base and tell us how far you’d travel."],
  ["Preferences", "Let's find events that fit your life.", "Choose your preferences and mark any firm limits."],
  ["Personal radar", "What's something you'd hate to miss?", "Describe a dream event and choose which updates you’d like."],
];

export function explicitInterest(name: string): DiscoveryInterest {
  return { name, type: "topic", source: "explicit", confidence: 1, related: [],
    priority: "curious", source_text: name, confirmed: true };
}
