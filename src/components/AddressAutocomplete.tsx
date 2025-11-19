// src/components/AddressAutocomplete.tsx
import React, { useEffect, useRef } from "react";

export type AddressSuggestion = {
  line1: string;
  city?: string;
  postcode?: string;
  country?: string;
  fullText: string;
};

type Props = {
  value: string;
  onChange: (val: string) => void;
  onSelect: (addr: AddressSuggestion) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  helperText?: string;
};

declare global {
  interface Window {
    google?: any;
  }
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className = "",
  disabled,
  label,
  helperText,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    if (!window.google?.maps?.places || !inputRef.current) {
      return;
    }

    // Avoid double-initialising
    if (autocompleteRef.current) return;

    const ac = new window.google.maps.places.Autocomplete(
      inputRef.current,
      {
        types: ["geocode"],
        // If you want to restrict to a country/countries, uncomment:
        // componentRestrictions: { country: ["za", "gb"] },
      }
    );

    autocompleteRef.current = ac;

    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place) return;

      const comps: any[] = place.address_components || [];

      const get = (type: string): string => {
        const comp = comps.find((c) => c.types?.includes(type));
        return comp?.long_name || comp?.short_name || "";
      };

      const streetNumber = get("street_number");
      const route = get("route");
      const line1 =
        [streetNumber, route].filter(Boolean).join(" ") ||
        place.name ||
        "";

      const city =
        get("locality") ||
        get("postal_town") ||
        get("sublocality") ||
        get("administrative_area_level_2") ||
        "";

      const postcode = get("postal_code") || "";
      const country = get("country") || "";
      const full =
        place.formatted_address ||
        [line1, city, postcode, country]
          .filter(Boolean)
          .join(", ");

      const suggestion: AddressSuggestion = {
        line1,
        city: city || undefined,
        postcode: postcode || undefined,
        country: country || undefined,
        fullText: full,
      };

      // Let parent decide how to use it
      onSelect(suggestion);
    });

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, [onSelect]);

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-xs font-medium text-slate-600">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          placeholder ||
          "Start typing and choose an address from suggestions…"
        }
        className={
          className ||
          "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50"
        }
      />
      {helperText && (
        <p className="text-[11px] text-slate-500">{helperText}</p>
      )}
      {!window.google?.maps?.places && (
        <p className="text-[11px] text-amber-600">
          Google Places script not loaded – this will behave as a normal
          text field.
        </p>
      )}
    </div>
  );
}
