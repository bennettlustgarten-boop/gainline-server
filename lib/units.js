// Weight units a coach can log a food amount in — macros are always
// calculated per 100g internally, so everything gets converted to grams
// first. Keep in sync with WEIGHT_UNITS in public/app.js.
const WEIGHT_UNITS = { g: 1, oz: 28.3495, lb: 453.592, kg: 1000 };

function gramsFromAmount(amount, unit) {
  return (Number(amount) || 0) * (WEIGHT_UNITS[unit] || 1);
}

module.exports = { WEIGHT_UNITS, gramsFromAmount };
