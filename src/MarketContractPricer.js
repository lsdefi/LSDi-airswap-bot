import BigNumber from 'bignumber.js';
import fetch from 'node-fetch';

import { normalizeCompoundData } from './utils/normalizeCompoundData';
import { wrapAsBigNumber } from './utils/wrapAsBigNumber';

export class MarketContractPricer {
  constructor(strategy) {
    this.minSpread = new BigNumber(0.75);
    this.spreadWidth = new BigNumber(0);
    this.strategy = strategy;
  }

  get config() {
    return this.strategy.config;
  }

  get contract() {
    return this.strategy.contract;
  }

  get sanity() {
    return this.strategy.sanity;
  }

  async applySkew(quote, skew, side) {
    let proposed;

    if (side === 'taker') { // bot is buying back the position token
      proposed = quote.minus(skew);
    }

    if (side === 'maker') { // bot is selling the position token
      proposed = quote.plus(skew);
    }

    await this.sanity.greaterThanZero(proposed);
    await this.sanity.lessThanBand(proposed);

    return proposed;
  }

  async get(address, side) {
    const { longAddress, shortAddress } = await this.strategy.contract.tokenAddresses();

    if (address === longAddress) {
      return this.longPrice(side);
    }

    if (address === shortAddress) {
      return this.shortPrice(side);
    }

    return this.config.collateralPrice();
  }

  async longPrice(side) {
    const floor = await this.contract.floor();
    const spot = await this.spotPrice();
    const skew = await this.skew();
    const quote = await spot.minus(floor);

    return this.applySkew(quote, skew, side);
  }

  async shortPrice(side) {
    const ceiling = await this.contract.ceiling();
    const spot = await this.spotPrice();
    const skew = await this.skew();
    const quote = await ceiling.minus(spot);

    return this.applySkew(quote, skew, side);
  }

  async skew() {
    const ceiling = await this.contract.ceiling();
    const floor = await this.contract.floor();

    const skew = ceiling.plus(floor).dividedBy(2).multipliedBy(this.spreadWidth);
    const minSkew = this.minSpread.dividedBy(2);

    if (skew.isLessThan(minSkew)) {
      return minSkew;
    }

    return skew;
  }

  async spotPrice() {
    const oracleURL = await this.contract.oracleURL();

    try {
      const response = await fetch(oracleURL);
      const priceData = await response.json();
      const { price } = normalizeCompoundData(priceData);
      const spot = await wrapAsBigNumber(price);

      await this.sanity.isNumeric(spot);

      return spot;
    } catch (e) {
      console.log('CAUGHT ERROR', e);
      return this.spotPrice;
    }
  }
}

export default MarketContractPricer;
