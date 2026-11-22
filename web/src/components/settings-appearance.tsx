"use client";

import { SettingsSection } from "./settings-controls";
import { ThemeToggle } from "./theme-toggle";

export function SettingsAppearance() {
  return (
    <SettingsSection
      title="Appearance"
      description="Choose how Qwendo looks on this device. The change applies immediately."
    >
      <ThemeToggle />
    </SettingsSection>
  );
}
