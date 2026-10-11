/** Quantity contributed by one PickupLink after field/unit integrity checks. */
export function pickupLinkQuantity(measurement: Record<string, unknown>, quantityField = "value", multiplier = 1): number {
  const rawValue = Number(measurement[quantityField] ?? measurement.value ?? 0) || 0;
  return rawValue * multiplier;
}
