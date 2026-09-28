export function isFreePrice(value) {
  if (value === null || value === undefined || value === '') return false;
  const price = Number(value);
  return Number.isFinite(price) && price === 0;
}
