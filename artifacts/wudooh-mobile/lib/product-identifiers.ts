export type ProductIdentifiers = {
  name: string;
  barcode?: string;
  sku?: string;
  code?: string;
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function matchesProductBarcode(product: ProductIdentifiers, barcode: string): boolean {
  const normalizedBarcode = normalize(barcode);
  return Boolean(normalizedBarcode) && [product.barcode, product.sku, product.code]
    .some((value) => normalize(value) === normalizedBarcode);
}

export function matchesProductSearch(product: ProductIdentifiers, query: string): boolean {
  const normalizedQuery = normalize(query);
  return !normalizedQuery || [product.name, product.barcode, product.sku, product.code]
    .some((value) => normalize(value).includes(normalizedQuery));
}