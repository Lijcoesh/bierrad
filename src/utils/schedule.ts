const zone = "Europe/Amsterdam";
export function amsterdamInput(now: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return (
    part("year") +
    "-" +
    part("month") +
    "-" +
    part("day") +
    "T" +
    part("hour") +
    ":" +
    part("minute")
  );
}
export function parseAmsterdamInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const wall = Date.parse(value + "Z");
  if (!Number.isFinite(wall)) return NaN;
  let instant = wall;
  for (let i = 0; i < 3; i++)
    instant += wall - Date.parse(amsterdamInput(instant) + "Z");
  return amsterdamInput(instant) === value ? instant : NaN;
}
export function nextFridayInput(now: number): string {
  const day = new Date(amsterdamInput(now).slice(0, 10) + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + ((5 - day.getUTCDay() + 7) % 7));
  let value = day.toISOString().slice(0, 10) + "T15:45";
  if (parseAmsterdamInput(value) <= now + 4000) {
    day.setUTCDate(day.getUTCDate() + 7);
    value = day.toISOString().slice(0, 10) + "T15:45";
  }
  return value;
}
export function formatScheduledTime(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
