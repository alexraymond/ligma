/**
 * The Studio's design-system picker is the shared one.
 *
 * Phase 3 shipped a build-time `CATALOG` constant here and wrote down what
 * would replace it: "a `GET /api/design-systems` route reading the same
 * directory, swapped in behind `CATALOG` with no change to this component".
 * Phase 4 built that route, so the component moved to `components/pickers/`
 * where every composer can reach it, and this file is the seam that keeps the
 * Studio's import path working.
 *
 * `CATALOG` is deliberately gone rather than kept as a stale copy — a static
 * list that no longer feeds the picker is exactly the drift the endpoint
 * exists to end.
 */

export {
  DesignSystemPicker,
  type DesignSystemPickerProps,
} from '@/components/pickers/design-system-picker';
