import 'core-js/stable';
import 'regenerator-runtime/runtime';

import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { fetch } from 'node-fetch';
import { Router } from 'airswap.js/src/protocolMessaging';

import { erc20Generic } from './abi/erc20Generic';
import { Utils } from './Utils';

console.log('Configuring maker...');

const cdai = '0xf5dce57282a584d2746faf1593d3121fcac444dc';

const config = {
  collateralAddress: Utils.validateHexString(process.env.COLLATERAL_ADDRESS),
  priceFeed: `https://api.compound.finance/api/v2/ctoken?addresses[]=${cdai}`,
  privateKey: Utils.validateHexString(process.env.PRIVATE_KEY),
  tokens: process.env.TOKENS.split(',').map(Utils.validateHexString),
};

const provider = ethers.getDefaultProvider();

const wallet = new ethers.Wallet(config.privateKey);

const address = wallet.address.toLowerCase();
const keyspace = false;
const messageSigner = data => wallet.signMessage(data);
const requireAuthentication = true;
const jsonrpc = '2.0';

const getPrice = async () => {
  const feed = await fetch(config.priceFeed);

  const { value } = feed[0].supply_rate;

  // TODO: Any math here... rounding!!
  return value;
};

const getBalance = async (makerAddress, tokenAddress) => {
  const contract = new ethers.Contract(tokenAddress, erc20Generic, provider);
  const balance = await contract.balanceOf(makerAddress);
  return Utils.wrapAsBigNumber(balance.toString());
};

const signOrder = async (order) => {
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

  const signedMsg = await wallet.signMessage(ethers.utils.arrayify(hashedOrder));
  const sig = ethers.utils.splitSignature(signedMsg);

  return {
    ...order,
    ...sig,
  };
};

const router = new Router({ address, keyspace, messageSigner, requireAuthentication });

const main = async () => {
  console.log('Connecting to Airswap...');

  await router.connect().catch((e) => {
    console.log('unable to connect to the Airswap WebSocket', e);
    process.exit(1);
  });

  console.log('Setting intents...');

  const intents = [];

  config.tokens.forEach((token) => {
    intents.push({
      makerToken: token,
      role: 'maker',
      supportedMethods: ['getOrder', 'getQuote', 'getMaxQuote'],
      takerToken: config.collateralAddress,
    });
  });

  await router.setIntents(intents);

  router.RPC_METHODS.getOrder = async (payload) => {
    console.log('getOrder called with', payload);
    const { message, sender } = payload;
    const { id, makerAddress, makerToken, takerAddress, takerToken, takerAmount } = message;

    if (makerAddress !== address) {
      console.error('Maker address is not for this bot!', makerAddress);
      return;
    }

    // get their token balance
    const takerBalance = await getBalance(takerAddress, takerToken);

    // validate the balance
    if (takerBalance.isLessThan(takerAmount)) {
      console.error('Insufficient taker balance', takerBalance.toString(), '<', takerAmount);
      return;
    }

    // get our token balance
    const makerBalance = await getBalance(makerAddress, makerToken);

    // validate our balance
    const price = await getPrice();
    const requestedAmount = await Utils.wrapAsBigNumber(takerAmount);
    const requiredMakerAmount = requestedAmount.dividedBy(price);

    if (requiredMakerAmount.isLessThan(makerBalance)) {
      console.error(
        'Insufficient maker balance',
        makerBalance.toString(),
        '<',
        requiredMakerAmount.toString(),
      );
      return;
    }

    // Good to go
    const expiration = Math.round(new Date().getTime() / 1000) + 300; // Expire after 5 minutes
    const makerAmount = requiredMakerAmount.decimalPlaces(0).toString();
    const nonce = BigNumber(Math.random() * 100000).toFixed().toString();

    const order = {
      expiration,
      makerAddress,
      makerAmount,
      makerToken,
      nonce,
      takerAddress,
      takerAmount,
      takerToken,
    };

    const result = await signOrder(order);

    const response = { id, jsonrpc, result };

    // Send the order
    router.call(sender, response);
    console.log('sent order', response);
  };

  router.RPC_METHODS.getQuote = async (payload) => {
    console.log('getQuote called with', payload);
    const { message, sender } = payload;

    const { id, makerAddress, makerToken, takerAmount, takerToken } = message;

    const price = await getPrice();
    const requestedAmount = await Utils.wrapAsBigNumber(takerAmount);
    const requiredMakerAmount = requestedAmount.dividedBy(price);
    const makerAmount = requiredMakerAmount.decimalPlaces(0).toString();

    const result = { makerAddress, makerAmount, makerToken, takerAmount, takerToken };

    const response = { id, jsonrpc, result };

    // Send the quote
    router.call(sender, response);
    console.log('sent quote', response);
  };

  router.RPC_METHODS.getMaxQuote = async (payload) => {
    console.log('getMaxQuote called with', payload);
    const { message, sender } = payload;

    const { id, makerAddress, makerToken, takerToken } = message;


    // get our token balance
    const makerBalance = await getBalance(makerAddress, makerToken);

    // get the max amount
    const price = await getPrice();
    const takerAmount = makerBalance.toString();
    const makerAmount = makerBalance.multipliedBy(price);

    const result = { makerAddress, makerAmount, makerToken, takerAmount, takerToken };

    const response = { id, jsonrpc, result };

    // Send the quote
    router.call(sender, response);
    console.log('sent max quote', response);
  };
};

main();
