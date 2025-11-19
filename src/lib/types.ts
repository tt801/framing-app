// /src/lib/types.ts
export type OpeningShape = "rect" | "oval" | "circle";

export type MatOpening = {
  id: string;
  shape: OpeningShape;
  // position/size in cm relative to outer mat/window space:
  xCm: number; // left offset
  yCm: number; // top offset
  widthCm: number;
  heightCm: number;
  imageUrl?: string;  // optional per-opening image
};
