/** Ép kiểu string | string[] → string (Express 5 route params) */
export const s = (val: string | string[]): string => Array.isArray(val) ? val[0] : val
