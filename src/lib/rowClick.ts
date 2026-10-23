// What a left click on a work-item row means.
//
// A plain left click on an already-selected item renames it, like a file
// manager. Everything else keeps selecting: a click on an unselected row,
// a click with Ctrl/Cmd or Shift (they build a selection), a tap on a phone,
// and any click inside a multi-selection, where the user is managing the
// group rather than the item they happened to land on.
export type RowClickIntent = "rename" | "select";

export function rowClickIntent(opts: {
  isMulti: boolean;
  isShift: boolean;
  isMobile: boolean;
  isSelected: boolean;
  isMultiSelected: boolean;
}): RowClickIntent {
  if (!opts.isMulti && !opts.isShift && !opts.isMobile && opts.isSelected && !opts.isMultiSelected) {
    return "rename";
  }
  return "select";
}
