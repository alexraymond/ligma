'use client';

/**
 * The facet row above a catalog's filter box: one `<select>` per facet
 * dimension, plus a "Saved" switch every catalog gets regardless of what
 * structured metadata it carries.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { FacetOption } from './facets';

const ALL = '__all__';

export interface FacetSelectProps {
  label: string;
  options: FacetOption[];
  selected: string | null;
  onChange: (value: string | null) => void;
}

export function FacetSelect({ label, options, selected, onChange }: FacetSelectProps) {
  if (options.length === 0) return null;
  return (
    <Select
      value={selected ?? ALL}
      onValueChange={(value) => onChange(value === ALL ? null : value)}
    >
      <SelectTrigger className="h-7 w-auto gap-1.5 text-[11px]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.value} ({option.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SavedFacetSwitch({
  checked,
  onChange,
}: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label
      htmlFor="saved-only-switch"
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      <Switch
        id="saved-only-switch"
        checked={checked}
        onCheckedChange={onChange}
        className="h-4 w-7"
      />
      Saved only
    </label>
  );
}

export function FacetBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pb-0.5">{children}</div>;
}
