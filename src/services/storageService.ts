import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------
const KEYS = {
  DRIVER_NAME: '@driver_profile/name',
  BLOOD_GROUP: '@driver_profile/blood_group',
  GUARDIAN_PHONE: '@driver_profile/guardian_phone',
  INCIDENT_LOG: '@blackbox/incident_log',
  APP_LANGUAGE: '@app_language',
} as const;

/** Exported so other modules (e.g. i18n store) can reference the same key. */
export const STORAGE_KEYS = KEYS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DriverProfile {
  driverName: string;
  bloodGroup: string;
  guardianPhone: string;
}

export type IncidentType = 'drowsiness' | 'yawning' | 'distraction' | 'impact';

export interface IncidentRecord {
  id: string;
  type: IncidentType;
  timestamp: string; // ISO-8601
  /** Human-readable description of the alert trigger. */
  reason?: string;
  /** Google Maps link or "lat,lng" string when GPS was available. */
  location?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Guardian phone must be exactly 11 digits — no spaces, dashes, or country codes. */
const PHONE_REGEX = /^\d{11}$/;

export function validateGuardianPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone);
}

// ---------------------------------------------------------------------------
// Profile persistence
// ---------------------------------------------------------------------------

/**
 * Persist the full driver profile to AsyncStorage.
 * Throws if the guardian phone number does not match the 11-digit requirement.
 */
export async function saveDriverProfile(profile: DriverProfile): Promise<void> {
  if (!validateGuardianPhone(profile.guardianPhone)) {
    throw new Error(
      `Invalid guardian phone "${profile.guardianPhone}". Must be exactly 11 digits.`,
    );
  }

  await AsyncStorage.multiSet([
    [KEYS.DRIVER_NAME, profile.driverName],
    [KEYS.BLOOD_GROUP, profile.bloodGroup],
    [KEYS.GUARDIAN_PHONE, profile.guardianPhone],
  ]);
}

/**
 * Fetch the stored driver profile.
 * Returns `null` when no profile has been saved yet.
 *
 * NOTE: `AsyncStorage.multiGet` returns `[key, value | null][]` tuples,
 * so we must access index [1] of each tuple to extract the value.
 */
export async function fetchDriverProfile(): Promise<DriverProfile | null> {
  const entries = await AsyncStorage.multiGet([
    KEYS.DRIVER_NAME,
    KEYS.BLOOD_GROUP,
    KEYS.GUARDIAN_PHONE,
  ]);

  const driverName = entries[0]?.[1] ?? null;
  const bloodGroup = entries[1]?.[1] ?? null;
  const guardianPhone = entries[2]?.[1] ?? null;

  if (!driverName && !bloodGroup && !guardianPhone) {
    return null;
  }

  return {
    driverName: driverName ?? '',
    bloodGroup: bloodGroup ?? '',
    guardianPhone: guardianPhone ?? '',
  };
}

/**
 * Remove all stored driver profile data.
 */
export async function clearDriverProfile(): Promise<void> {
  await AsyncStorage.multiRemove([
    KEYS.DRIVER_NAME,
    KEYS.BLOOD_GROUP,
    KEYS.GUARDIAN_PHONE,
  ]);
}

// ---------------------------------------------------------------------------
// Black-Box Event Logger (read-only append)
// ---------------------------------------------------------------------------

/**
 * Append an incident record to the local black-box log.
 *
 * - Each entry is timestamped with an ISO-8601 string.
 * - Existing entries are never modified or deleted (append-only).
 * - Supported event types: `drowsiness`, `yawning`, `distraction`, `impact`.
 * - Optional `reason` provides a human-readable alert description.
 * - Optional `location` stores GPS coordinates (Google Maps URL or lat/lng).
 */
export async function logIncident(
  event: IncidentType,
  meta?: { reason?: string; location?: string },
): Promise<IncidentRecord> {
  const record: IncidentRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: event,
    timestamp: new Date().toISOString(),
    reason: meta?.reason,
    location: meta?.location,
  };

  const raw = await AsyncStorage.getItem(KEYS.INCIDENT_LOG);
  const existing: IncidentRecord[] = raw ? (JSON.parse(raw) as IncidentRecord[]) : [];

  existing.push(record);

  await AsyncStorage.setItem(KEYS.INCIDENT_LOG, JSON.stringify(existing));

  return record;
}

/**
 * Retrieve all stored incident records (most recent last).
 */
export async function fetchIncidentLog(): Promise<IncidentRecord[]> {
  const raw = await AsyncStorage.getItem(KEYS.INCIDENT_LOG);
  if (!raw) return [];
  return JSON.parse(raw) as IncidentRecord[];
}
