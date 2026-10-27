// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_EVENTS,
  getHistoricalEvent,
  type EventType,
} from './EventCards';

const VALID_EVENT_TYPES: EventType[] = ['collision', 'asat', 'docking', 'breakup'];

describe('HISTORICAL_EVENTS data integrity', () => {
  it('contains at least 7 events', () => {
    expect(HISTORICAL_EVENTS.length).toBeGreaterThanOrEqual(7);
  });

  it('all event IDs are unique', () => {
    const ids = HISTORICAL_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every event has all required string fields', () => {
    for (const event of HISTORICAL_EVENTS) {
      expect(event.id, `${event.id} — missing id`).toBeTruthy();
      expect(event.title, `${event.id} — missing title`).toBeTruthy();
      expect(event.date, `${event.id} — missing date`).toBeTruthy();
      expect(event.collisionTimeUtc, `${event.id} — missing collisionTimeUtc`).toBeTruthy();
    }
  });

  it('collisionTimeUtc is a valid ISO-8601 UTC timestamp', () => {
    const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    for (const event of HISTORICAL_EVENTS) {
      expect(
        isoUtc.test(event.collisionTimeUtc),
        `${event.id}.collisionTimeUtc = "${event.collisionTimeUtc}" does not match ISO UTC`,
      ).toBe(true);
    }
  });

  it('altitudeKm is a positive number for every event', () => {
    for (const event of HISTORICAL_EVENTS) {
      expect(event.altitudeKm, `${event.id}.altitudeKm`).toBeGreaterThan(0);
    }
  });

  it('collisionGeo coordinates are in valid geographic ranges', () => {
    for (const event of HISTORICAL_EVENTS) {
      const { latDeg, lonDeg, altKm } = event.collisionGeo;
      expect(latDeg, `${event.id} lat`).toBeGreaterThanOrEqual(-90);
      expect(latDeg, `${event.id} lat`).toBeLessThanOrEqual(90);
      expect(lonDeg, `${event.id} lon`).toBeGreaterThanOrEqual(-180);
      expect(lonDeg, `${event.id} lon`).toBeLessThanOrEqual(180);
      expect(altKm, `${event.id} altKm`).toBeGreaterThan(0);
    }
  });

  it('every event has a valid eventType', () => {
    for (const event of HISTORICAL_EVENTS) {
      expect(
        VALID_EVENT_TYPES,
        `${event.id}.eventType is not a known type`,
      ).toContain(event.eventType);
    }
  });

  it('objectB is null for ASAT and breakup events', () => {
    const single = HISTORICAL_EVENTS.filter((e) => e.eventType === 'asat' || e.eventType === 'breakup');
    expect(single.length).toBeGreaterThan(0);
    for (const event of single) {
      expect(event.objectB, `${event.id} (${event.eventType}) should have objectB = null`).toBeNull();
    }
  });

  it('objectB is defined for collision and docking events', () => {
    const paired = HISTORICAL_EVENTS.filter((e) => e.eventType === 'collision' || e.eventType === 'docking');
    expect(paired.length).toBeGreaterThan(0);
    for (const event of paired) {
      expect(event.objectB, `${event.id} (${event.eventType}) should have objectB defined`).not.toBeNull();
    }
  });

  it('every event has info.title, info.reason, and info.outcome', () => {
    for (const event of HISTORICAL_EVENTS) {
      expect(event.info.title, `${event.id}.info.title`).toBeTruthy();
      expect(event.info.reason, `${event.id}.info.reason`).toBeTruthy();
      expect(event.info.outcome, `${event.id}.info.outcome`).toBeTruthy();
    }
  });

  it('approach vectors: approachB is null iff objectB is null', () => {
    for (const event of HISTORICAL_EVENTS) {
      const bNull = event.objectB === null;
      expect(
        event.approachB === null,
        `${event.id}: approachB/objectB null-ness must match`,
      ).toBe(bNull);
    }
  });

  it('approachA inclination is in 0–180° range', () => {
    for (const event of HISTORICAL_EVENTS) {
      const incl = event.approachA.inclinationDeg;
      expect(incl, `${event.id}.approachA.inclinationDeg`).toBeGreaterThanOrEqual(0);
      expect(incl, `${event.id}.approachA.inclinationDeg`).toBeLessThanOrEqual(180);
    }
  });

  it('objectA TLE lines are exactly 69 characters long', () => {
    for (const event of HISTORICAL_EVENTS) {
      expect(
        event.objectA.line1.length,
        `${event.id}.objectA.line1 length`,
      ).toBe(69);
      expect(
        event.objectA.line2.length,
        `${event.id}.objectA.line2 length`,
      ).toBe(69);
    }
  });
});

describe('getHistoricalEvent', () => {
  it('returns the matching event for a known ID', () => {
    const event = getHistoricalEvent('iridium-cosmos');
    expect(event).toBeDefined();
    expect(event!.id).toBe('iridium-cosmos');
    expect(event!.eventType).toBe('collision');
  });

  it('returns undefined for an unknown ID', () => {
    expect(getHistoricalEvent('does-not-exist')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getHistoricalEvent('')).toBeUndefined();
  });

  it('finds every event by its own ID (round-trip)', () => {
    for (const event of HISTORICAL_EVENTS) {
      const found = getHistoricalEvent(event.id);
      expect(found, `round-trip for id "${event.id}"`).toBe(event);
    }
  });
});
