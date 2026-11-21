/**
 * The clipboard files carried by one paste event. A text paste returns an empty
 * list, so a pasted sentence never becomes an attachment.
 *
 * @param data - the paste payload.
 * @returns the files it carried, in source order.
 */
export function clipboardFiles(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files ?? []);
}
