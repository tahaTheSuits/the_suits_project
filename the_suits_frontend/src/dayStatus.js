// Sunday / holiday / paused-cleaning label for an occupancy day (report row
// or day metadata). null for an ordinary day.
export function dayBadge(day) {
  if (!day) return null;
  if (day.isHoliday) {
    return { kind: "holiday", text: `Holiday${day.holidayName ? `: ${day.holidayName}` : ""}` };
  }
  if (day.isSunday) {
    return { kind: "sunday", text: day.noScheduledCleaning ? "Sunday · No cleaning" : "Sunday" };
  }
  if (day.noScheduledCleaning) return { kind: "paused", text: "No scheduled cleaning" };
  return null;
}

