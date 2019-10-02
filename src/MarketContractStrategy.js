import { ethers } from 'ethers';
import fetch from 'node-fetch';

import { getBalance } from './utils/getBalance.js';
import { marketContract } from './abi/marketContract.js';
import { validateHexString } from './utils/validateHexString.js';
import { wrapAsBigNumber } from './utils/wrapAsBigNumber.js';

const normalizeCoincapData = (payload) => {
  console.log('COINCAP PAYLOAD', payload);
  const { data, timestamp } = payload;
  const { priceUsd, rateUsd, symbol } = data;

  return {
    symbol,
    timestamp,

    price: rateUsd || priceUsd,
  };
};

export class MarketContractStrategy {
  constructor(address, config) {
    this.address = address.toLowerCase();
    this.config = config;
    this.marketContracts = {};
    this.spreadBasis = 0.001;
  }

  async applySpread(price, side) {
    const spread = await this.spread(price);

    if (side === 'buy') {
      return price.minus(spread);
    }

    return price.plus(spread);
  }

  async enableTokens() {
    const { longAddress, shortAddress } = await this.getPositionTokenAddresses();
    await this.config.enableToken(longAddress);
    await this.config.enableToken(shortAddress);
    return true;
  }

  async getAmounts(makerAmount, makerToken, takerAmount, takerToken) {
    const makerPrice = await this.getPrice(makerToken, 'sell');
    const takerPrice = await this.getPrice(takerToken, 'buy');
    let makerAmountD;
    let takerAmountD;

    if (takerAmount) {
      takerAmountD = await this.config.decimalize(takerToken, takerAmount);
      makerAmountD = takerPrice.multipliedBy(takerAmountD).dividedBy(makerPrice);
    }

    if (makerAmount) {
      makerAmountD = await this.config.decimalize(makerToken, makerAmount);
      takerAmountD = makerPrice.multipliedBy(makerAmountD).dividedBy(takerPrice);
    }

    const makerAmountI = await this.config.integerize(makerToken, makerAmountD);
    const takerAmountI = await this.config.integerize(takerToken, takerAmountD);

    return { makerAmountD, makerAmountI, makerPrice, takerAmountD, takerAmountI,  takerPrice };
  }

  async getPositionTokenAddresses() {
    const { longPositionTokenAddress, shortPositionTokenAddress } = await this.loadContract();

    return {
      longAddress: longPositionTokenAddress.toLowerCase(),
      shortAddress: shortPositionTokenAddress.toLowerCase(),
    };
  }

  async getPrice(address, side) {
    const { longAddress, shortAddress } = await this.getPositionTokenAddresses();

    if (address === longAddress) {
      return this.longPrice(side);
    }

    if (address === shortAddress) {
      return this.shortPrice(side);
    }

    return this.config.collateralPrice();
  }

  async getQuote(params) {
    const { makerAmount, makerToken, takerAmount, takerToken } = params;
    const makerAddress = this.config.walletAddress;

    const amounts = await this.getAmounts(makerAmount, makerToken, takerAmount, takerToken);
    console.log('AMOUNTS', amounts);
    let { makerAmountD, takerAmountD } = amounts;
    const { makerPrice, takerPrice } = amounts;

    if (this.config.isCollateralToken(makerToken)) {
      const max = this.maxPurchase();

      if (takerAmountD.isGreaterThan(max)) {
        takerAmountD = max;
        makerAmountD = takerPrice.multipliedBy(takerAmountD).dividedBy(makerPrice);
      }
    } else {
      const max = this.maxSale();

      if (makerAmountD.isGreaterThan(max)) {
        makerAmountD = max;
        takerAmountD = makerPrice.multipliedBy(makerAmountD).dividedBy(takerPrice);
      }
    }

    return {
      makerAddress,
      makerToken,
      takerToken,

      makerAmount: (await this.config.integerize(makerToken, makerAmountD)).toFixed(),
      takerAmount: (await this.config.integerize(takerToken, takerAmountD)).toFixed(),
    };
  }

  async getMaxQuote(params) {
    const { makerToken, takerToken } = params;
    const makerAddress = this.config.walletAddress;
    const makerPrice = await this.getPrice(makerToken, 'sell');
    const takerPrice = await this.getPrice(takerToken, 'buy');
    let makerAmountD;
    let takerAmountD;

    if (this.config.isCollateralToken(makerToken)) {
      takerAmountD = this.maxPurchase();
      makerAmountD = takerPrice.multipliedBy(takerAmountD).dividedBy(makerPrice);
    } else {
      makerAmountD = this.maxSale();
      takerAmountD = makerPrice.multipliedBy(makerAmountD).dividedBy(takerPrice);
    }

    return {
      makerAddress,
      makerToken,
      takerToken,

      makerAmount: (await this.config.integerize(makerToken, makerAmountD)).toFixed(),
      takerAmount: (await this.config.integerize(takerToken, takerAmountD)).toFixed(),
    };
  }

  async intents() {
    const role = 'maker';
    const supportedMethods = ['getOrder', 'getQuote', 'getMaxQuote'];

    const base = { role, supportedMethods };
    const { collateralAddress } = this.config;
    const { longAddress, shortAddress } = await this.getPositionTokenAddresses();

    const combinations = [
      { makerToken: collateralAddress, takerToken: longAddress },
      { makerToken: longAddress, takerToken: collateralAddress },
      { makerToken: collateralAddress, takerToken: shortAddress },
      { makerToken: shortAddress, takerToken: collateralAddress },
    ];

    return combinations.map(combo => Object.assign({}, base, combo));
  }

  async loadContract() {
    if (this.contract) {
      return this.contract;
    }

    const { address } = this;

    console.log('Loading Market Contract', address);
    validateHexString(address);
    const contract = new ethers.Contract(address, marketContract, this.config.wallet);

    const [
      longPositionTokenAddress,
      shortPositionTokenAddress,
      priceCap,
      priceFloor,
      priceDecimalPlaces,
      oracleURL,
      oracleStatistic,
    ] = await Promise.all([
      contract.LONG_POSITION_TOKEN(),
      contract.SHORT_POSITION_TOKEN(),
      wrapAsBigNumber(contract.PRICE_CAP()),
      wrapAsBigNumber(contract.PRICE_FLOOR()),
      wrapAsBigNumber(contract.PRICE_DECIMAL_PLACES()),
      contract.ORACLE_URL(),
      contract.ORACLE_STATISTIC(),
    ]);

    this.contract = {
      address,
      longPositionTokenAddress,
      shortPositionTokenAddress,
      priceCap,
      priceFloor,
      priceDecimalPlaces,
      oracleURL,
      oracleStatistic,
    };

    console.log('CONTRACT', this.contract);

    return this.contract;
  }

  async longPrice(side) {
    const { priceDecimalPlaces, priceFloor } = await this.loadContract();
    const spotPrice = await this.spotPrice();
    const floor = await wrapAsBigNumber(priceFloor);
    const price = spotPrice.minus(floor.dividedBy(10 ** priceDecimalPlaces));

    return this.applySpread(price, side);
  }

  async match({ makerToken, takerToken }) {
    const { longAddress, shortAddress } = await this.getPositionTokenAddresses();
    const makerAddress = makerToken.toLowerCase();
    const takerAddress = takerToken.toLowerCase();

    return (
      makerAddress === longAddress
      || makerAddress === shortAddress
      || takerAddress === longAddress
      || takerAddress === shortAddress
    );
  }

  async maxPurchase() {
    const contract = await this.loadContract();
    const { priceCap, priceDecimalPlaces, priceFloor } = contract;

    const ceiling = await wrapAsBigNumber(priceCap);
    const floor = await wrapAsBigNumber(priceFloor);

    const spread = ceiling.minus(floor).dividedBy(10 ** priceDecimalPlaces);

    console.log('SPREAD IS', ceiling.toFixed(), ' - ', floor.toFixed(), spread.toFixed());

    if (spread.isLessThan(100)) {
      return wrapAsBigNumber(1);
    }

    if (spread.isLessThan(1000)) {
      return wrapAsBigNumber(0.1);
    }

    return wrapAsBigNumber(0.01);
  }

  async maxSale() {
    return this.maxPurchase();
  }

  async shortPrice(side) {
    const { priceCap, priceDecimalPlaces } = await this.loadContract();
    const spotPrice = await this.spotPrice();
    const ceiling = await wrapAsBigNumber(priceCap);
    const price = ceiling.multipliedBy(10 ** priceDecimalPlaces).minus(spotPrice);

    return this.applySpread(price, side);
  }

  async shortToken() {
    const contract = await this.loadContract();
    return this.config.erc20Contract(contract.shortPositionTokenAddress);
  }

  async spotPrice() {
    const contract = await this.loadContract();

    const response = await fetch(contract.oracleURL);
    const priceData = await response.json();
    const { price } = normalizeCoincapData(priceData);

    // NOTE: This currently only works with coincap feeds and needs to be updated
    // when price strategies are a thing at the contract level.
    return wrapAsBigNumber(price);
  }

  async spread(price) {
    // NOTE: Make this smarter than 1 basis point later :D
    return price.multipliedBy(this.spreadBasis);
  }

  async validateBalances({ makerAmount, makerToken, takerAddress, takerAmount, takerToken }) {
    if (!makerAmount && !takerAmount) {
      console.log('NULL amount order halted');
      return false;
    }

    const {
      makerAmountD,
      makerAmountI,
      makerPrice,
      takerAmountD,
      takerAmountI,
      takerPrice,
    } = await this.getAmounts(makerAmount, makerToken, takerAmount, takerToken);

    if (makerAmountD.isZero()) {
      console.log('Zero amount order request halted');
      return false;
    }

    const makerBalance = await getBalance(this.config.walletAddress, makerToken, this.config);
    console.log('MAKER BALANCE', makerBalance.toFixed());

    if (makerBalance.isLessThan(makerAmountI)) {
      console.log(
        'Insufficient maker balance',
        makerAmountI.toFixed(),
        '<',
        makerBalance.toFixed(),
      );
      return false;
    }

    const takerBalance = await getBalance(takerAddress, takerToken, this.config);

    console.log('TAKER BALANCE', takerBalance.toFixed());

    if (takerBalance.isLessThan(takerAmountI)) {
      console.log(
        'Insufficient taker balance',
        takerBalance.toFixed(),
        '<',
        takerAmountI.toFixed(),
      );
      return false;
    }

    return {
      makerAmountD,
      makerPrice,
      takerAmountD,
      takerPrice,

      makerAmount: makerAmountI,
      takerAmount: takerAmountI,
    };
  }
}

export default MarketContractStrategy;
