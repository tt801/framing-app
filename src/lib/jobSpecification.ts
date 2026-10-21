import { savedJobDetails } from './jobEditing';

type SavedRecord = Record<string, unknown>;
const NOT_RECORDED = "Not recorded";
const record = (value: unknown): SavedRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as SavedRecord
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const measurement = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isFinite(value) ? `${value} cm` : undefined;

/** Read only the frozen Job snapshot; never resolve materials from a catalogue. */
export function jobSpecificationFields(value: unknown): { label: string; value: string }[] {
  const job = record(value);
  const details = savedJobDetails(job);
  const dims = { ...record(job.dims), ...record(details.dims) };
  const artwork = record(job.artwork);
  const art = record(dims.art);
  const visible = record(dims.visible);
  const frame = { ...record(job.frame), ...record(details.frame) };
  const glazing = { ...record(job.glazing), ...record(details.glazing) };
  const mats = { ...record(job.mats), ...record(details.mats) };
  const printing = { ...record(job.printing), ...record(details.printing) };
  const backer = { ...record(job.backer), ...record(details.backer) };
  const dimensions = (width: unknown, height: unknown) => {
    const w = measurement(width), h = measurement(height);
    if (!w && !h) return NOT_RECORDED;
    return `${w ?? NOT_RECORDED} × ${h ?? NOT_RECORDED}`.replace(/ cm × (.*) cm$/, ' × $1 cm');
  };
  const mat = (index: number) => {
    const saved = record(mats[`mat${index}`]);
    if (mats[`hasMat${index}`] === false) return "None";
    if (!Object.keys(saved).length) return NOT_RECORDED;
    return `${text(saved.name) ?? NOT_RECORDED} — ${measurement(saved.borderCm) ?? NOT_RECORDED} border`;
  };
  const state = (saved: SavedRecord) => saved.include === false ? "Off" : saved.include === true ? "On" : NOT_RECORDED;
  const additionalMats = mats.hasMat2 === false && mats.hasMat3 === false
    ? "None"
    : mats.hasMat2 === undefined && mats.hasMat3 === undefined && !mats.mat2 && !mats.mat3
      ? NOT_RECORDED
      : `Mat 2: ${mat(2)}; Mat 3: ${mat(3)}`;

  return [
    { label: "Artwork dimensions", value: dimensions(art.widthCm ?? artwork.widthCm ?? job.artWcm, art.heightCm ?? artwork.heightCm ?? job.artHcm) },
    { label: "Visible dimensions", value: dimensions(visible.widthCm ?? job.visibleWcm, visible.heightCm ?? job.visibleHcm) },
    { label: "Frame", value: text(frame.name) ?? text(job.frameName) ?? text(frame.profile) ?? NOT_RECORDED },
    { label: "Frame face width", value: measurement(dims.frameFaceWidthCm ?? frame.faceWidthCm ?? job.faceWidthCm) ?? NOT_RECORDED },
    { label: "Mat 1", value: mat(1) },
    { label: "Additional mats", value: additionalMats },
    { label: "Glazing", value: text(glazing.name) ?? text(job.glazingName) ?? text(frame.glazing) ?? NOT_RECORDED },
    { label: "Printing", value: state(printing) },
    { label: "Foam/backer", value: state(backer) },
  ];
}
