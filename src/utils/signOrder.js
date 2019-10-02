import { ethers } from 'ethers';

export const signOrder = async (order, config) => {
  const types = [
    'address', // makerAddress
    'uint256', // makerAmount
    'address', // makerToken
    'address', // takerAddress
    'uint256', // takerAmount
    'address', // takertoken
    'uint256', // expiration
    'uint256', // nonce
  ];

  const {
    expiration,
    makerAddress,
    makerAmount,
    makerToken,
    nonce,
    takerAddress,
    takerAmount,
    takerToken,
  } = order;

  const hashedOrder = ethers.utils.solidityKeccak256(types, [
    makerAddress,
    makerAmount,
    makerToken,
    takerAddress,
    takerAmount,
    takerToken,
    expiration,
    nonce,
  ]);

  console.log(hashedOrder);

  const signedMsg = await config.wallet.signMessage(ethers.utils.arrayify(hashedOrder));
  const sig = ethers.utils.splitSignature(signedMsg);

  return {
    ...order,
    ...sig,
  };
};

export default signOrder;
