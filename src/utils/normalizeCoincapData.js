export const normalizeCoincapData = (payload) => {
  console.log('COINCAP PAYLOAD', payload);
  const { data, timestamp } = payload;
  const { priceUsd, rateUsd, symbol } = data;

  return {
    symbol,
    timestamp,

    price: rateUsd || priceUsd,
  };
};

export default normalizeCoincapData;
