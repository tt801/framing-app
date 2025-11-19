export const itemLabel = (i: any) =>
  (i?.description ?? i?.item ?? i?.name ?? i?.label ?? i?.title ?? i?.productName ?? i?.product?.name ?? i?.text ?? "").toString().trim();

export const itemQty = (i: any) =>
  Number(i?.qty ?? i?.quantity ?? 1);

export const itemUnit = (i: any) =>
  Number(i?.unitPrice ?? i?.price ?? i?.unit_cost ?? i?.unitcost ?? i?.rate ?? 0);

export const itemTotal = (i: any) => {
  const explicit = (i?.total ?? i?.line_total ?? i?.amount);
  if (explicit != null) return Number(explicit);
  return itemQty(i) * itemUnit(i);
};
