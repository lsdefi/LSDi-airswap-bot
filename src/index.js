import Router from 'airswap.js/src/protocolMessaging/index.js';

import { Configuration } from './Configuration.js';
import { MarketContractStrategy } from './MarketContractStrategy.js';
import { signOrder } from './utils/signOrder.js';

console.log('Configuring maker...');

const config = new Configuration();

const strategies = config.marketContracts
  .map(address => new MarketContractStrategy(address, config));

const router = new Router(config.airswapRouterConfiguration);

const main = async () => {
  console.log('Connecting to Airswap...');

  await router.connect().catch((e) => {
    console.log('unable to connect to the Airswap WebSocket', e);
    process.exit(1);
  });

  let intents = [];

  await config.enableCollateralToken();

  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < strategies.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await strategies[i].enableTokens();
    // eslint-disable-next-line no-await-in-loop
    intents = intents.concat(await strategies[i].intents());
  }

  console.log('Setting intents...', intents);

  await router.setIntents(intents).catch((e) => {
    console.log('unable to set intents', e);
    process.exit(1);
  });

  const { jsonrpc } = config;

  const defaultError = 'We\'re sorry. The maker is having a bad trip and can\'t complete your request.';

  const respondWithError = (sender, id, error = defaultError) => {
    const result = { error };
    const response = { id, jsonrpc, result };

    // Send the order
    router.call(sender, response);
  };

  router.RPC_METHOD_ACTIONS.getOrder = async (payload) => {
    console.log('getOrder called with', payload);
    const { message, sender } = payload;
    const { id, params } = message;
    const { makerToken, takerAddress, takerToken } = params;
    const makerAddress = config.walletAddress;

    const matchers = await Promise.all(strategies.map(strat => strat.match(params)));
    const match = matchers.find(m => m[1]);
    const strategy = match[0];

    if (!strategy) {
      console.log('requested order has no registered strategy');
      respondWithError(sender, id);
      return;
    }

    const pricesAndAmounts = await strategy.validateBalances(params);
    console.log('PRICES AND AMOUNTS', pricesAndAmounts);

    if (pricesAndAmounts.error) {
      respondWithError(sender, id, pricesAndAmounts.error);
      return;
    }

    const { makerAmount, takerAmount } = pricesAndAmounts;

    // Good to go
    const expiration = Math.round(new Date().getTime() / 1000) + 300; // Expire after 5 minutes
    const nonce = Number(Math.random() * 100000).toFixed().toString();

    const order = {
      expiration,
      makerAddress,
      makerToken,
      nonce,
      takerAddress,
      takerToken,

      makerAmount: makerAmount.toFixed(),
      takerAmount: takerAmount.toFixed(),
    };

    console.log('ORDER', order);

    try {
      const result = await signOrder(order, config);
      const response = { id, jsonrpc, result };

      // Send the order
      router.call(sender, response);
      console.log('sent order', response);
    } catch (e) {
      console.error(e);
      respondWithError(sender, id);
    }
  };

  router.RPC_METHOD_ACTIONS.getQuote = async (payload) => {
    console.log('getQuote called with', payload);
    const { message, sender } = payload;
    const { id, params } = message;

    const matchers = await Promise.all(strategies.map(strat => strat.match(params)));
    const match = matchers.find(m => m[1]);
    const strategy = match[0];

    if (!strategy) {
      console.log('requested quote has no registered strategy');
      respondWithError(sender, id);
      return;
    }

    try {
      const result = await strategy.getQuote(params);
      const response = { id, jsonrpc, result };

      // Send the quote
      router.call(sender, response);
      console.log('sent quote', response);
    } catch (e) {
      console.error(e);
      respondWithError(sender, id);
    }
  };

  router.RPC_METHOD_ACTIONS.getMaxQuote = async (payload) => {
    console.log('getMaxQuote called with', payload);
    const { message, sender } = payload;
    const { id, params } = message;

    const matchers = await Promise.all(strategies.map(strat => strat.match(params)));
    const match = matchers.find(m => m[1]);
    const strategy = match[0];

    if (!strategy) {
      console.log('requested quote has no registered strategy');
      respondWithError(sender, id);
      return;
    }

    try {
      const result = await strategy.getMaxQuote(params);
      const response = { id, jsonrpc, result };

      // Send the quote
      router.call(sender, response);
      console.log('sent max quote', response);
    } catch (e) {
      console.error(e);
      respondWithError(sender, id);
    }
  };

  console.log('Ready to make the markets');
};

main();
