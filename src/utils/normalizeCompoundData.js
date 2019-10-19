import BigNumber from 'bignumber.js';

export const normalizeCompoundData = (payload) => {
  console.log('COMPOUND PAYLOAD', payload);
  const { cToken } = payload;

  return {
    price: BigNumber(cToken[0].supply_rate.value).multipliedBy(100).dp(2).toNumber(),
  };
};

export default normalizeCompoundData;
