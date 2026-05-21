export const FREQUENCY_DECIMAL_PLACES = 1;
export const COORDINATE_DECIMAL_PLACES = 5;

export const FORMAT_FREQUENCY = digitsInfo(FREQUENCY_DECIMAL_PLACES);
export const FORMAT_COORDINATE = digitsInfo(COORDINATE_DECIMAL_PLACES);

function digitsInfo(places: number): string {
  return `1.${places}-${places}`;
}
