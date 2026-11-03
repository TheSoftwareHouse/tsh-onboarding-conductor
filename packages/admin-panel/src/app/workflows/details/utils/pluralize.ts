/** "1 step", "2 steps"; pass `plural` where adding an "s" is wrong. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
