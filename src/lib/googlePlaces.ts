// src/lib/googlePlaces.ts
import { useEffect, useState } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

// For TS not to complain about global google
declare const google: any;

export type PlaceSuggestion = {
  description: string;
  placeId: string;
};

export type ParsedAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
};

export function usePlacesAutocomplete(query: string): PlaceSuggestion[] {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  useEffect(() => {
    if (!query || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const g = (window as any).google;
    if (!g?.maps?.places?.AutocompleteService) {
      // Google script not loaded / Places not available
      return;
    }

    const service = new g.maps.places.AutocompleteService();
    let cancelled = false;

    service.getPlacePredictions(
      {
        input: query,
        types: ["geocode"],
      },
      (predictions: any[], status: string) => {
        if (cancelled) return;

        const OK =
          g.maps.places.PlacesServiceStatus.OK ||
          "OK"; // be defensive

        if (status !== OK || !Array.isArray(predictions)) {
          setSuggestions([]);
          return;
        }

        setSuggestions(
          predictions.map((p: any) => ({
            description: p.description,
            placeId: p.place_id,
          }))
        );
      }
    );

    return () => {
      cancelled = true;
    };
  }, [query]);

  return suggestions;
}

export function fetchPlaceDetails(placeId: string): Promise<ParsedAddress> {
  return new Promise((resolve, reject) => {
    const g = (window as any).google;
    if (!g?.maps?.places?.PlacesService) {
      reject(new Error("Google PlacesService not available"));
      return;
    }

    const dummyDiv = document.createElement("div");
    const service = new g.maps.places.PlacesService(dummyDiv);

    service.getDetails(
      {
        placeId,
        fields: ["address_components"],
      },
      (place: any, status: string) => {
        const OK =
          g.maps.places.PlacesServiceStatus.OK ||
          "OK"; // defensive

        if (status !== OK || !place?.address_components) {
          reject(new Error("Failed to fetch place details"));
          return;
        }

        const components: any[] = place.address_components;

        const byType = (type: string) =>
          components.find((c) => c.types?.includes(type)) || null;

        const streetNumber = byType("street_number")?.long_name || "";
        const route = byType("route")?.long_name || "";
        const sublocality =
          byType("sublocality")?.long_name ||
          byType("sublocality_level_1")?.long_name ||
          "";
        const locality =
          byType("locality")?.long_name ||
          byType("postal_town")?.long_name ||
          "";
        const adminArea =
          byType("administrative_area_level_1")?.short_name || "";
        const postalCode = byType("postal_code")?.long_name || "";
        const country = byType("country")?.long_name || "";

        const line1 = [streetNumber, route].filter(Boolean).join(" ");
        const line2 = [sublocality, adminArea].filter(Boolean).join(", ");

        resolve({
          line1: line1 || undefined,
          line2: line2 || undefined,
          city: locality || undefined,
          postalCode: postalCode || undefined,
          country: country || undefined,
        });
      }
    );
  });
}
