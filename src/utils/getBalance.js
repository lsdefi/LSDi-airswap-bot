import { wrapAsBigNumber } from './wrapAsBigNumber.js';

export const getBalance = async (accountAddress, tokenAddress, config) => {
  const contract = config.erc20Contract(tokenAddress);
  const balance = await contract.balanceOf(accountAddress);
  console.log('getBalance account:', accountAddress, 'token:', tokenAddress, 'balance:', balance);
  return wrapAsBigNumber(balance);
};

export default getBalance;
