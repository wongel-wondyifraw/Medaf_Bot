function calculateSellingPrice(basePrice) {
  const margin = parseFloat(process.env.PROFIT_MARGIN) || 30;
  const selling = basePrice * (1 + margin / 100);
  const profit = selling - basePrice;
  return {
    sellingPrice: selling.toFixed(2),
    profit: profit.toFixed(2),
    margin,
  };
}

module.exports = { calculateSellingPrice };