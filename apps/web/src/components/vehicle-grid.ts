/**
 * Every grid of vehicle cards: one on a phone, two from `sm`, three once the shell is at its full
 * width. `VehicleCard` is drawn for that third — about 240px — so nothing in it is squeezed there.
 * Its own module so the card and its skeleton share it without importing each other.
 */
export const VEHICLE_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3';
