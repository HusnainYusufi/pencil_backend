/**
 * Units of measure: UN/ECE Recommendation 20 codes, as required in UBL 2.1
 * invoice lines by both ZATCA and JoFotara. Labels live in the frontend.
 */
export const UNIT_CODES = [
  'PCE', // piece
  'C62', // unit (one)
  'EA', // each
  'SET', // set
  'BX', // box
  'PK', // pack
  'CT', // carton
  'HUR', // hour
  'DAY', // day
  'WEE', // week
  'MON', // month
  'ANN', // year
  'KGM', // kilogram
  'GRM', // gram
  'TNE', // tonne
  'LTR', // litre
  'MTR', // metre
  'KMT', // kilometre
  'MTK', // square metre
  'MTQ', // cubic metre
  'LS', // lump sum
] as const;

export type UnitCode = (typeof UNIT_CODES)[number];
