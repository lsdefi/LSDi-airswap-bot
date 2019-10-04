import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';

import { marketContract } from './abi/marketContract.js';
import { validateHexString } from './utils/validateHexString.js';
import { wrapAsBigNumber } from './utils/wrapAsBigNumber.js';

export class MarketContractWrapper {
  constructor(strategy) {
    this.strategy = strategy;
  }

  get config() {
    return this.strategy.config;
  }

  async bandSpread() {
    const ceiling = await this.ceiling();
    const floor = await this.floor();

    return ceiling.minus(floor);
  }

  async ceiling() {
    const { priceCap, priceDecimalPlaces } = await this.load();

    return BigNumber(priceCap).dividedBy(10 ** priceDecimalPlaces);
  }

  async floor() {
    const { priceDecimalPlaces, priceFloor } = await this.load();

    return BigNumber(priceFloor).dividedBy(10 ** priceDecimalPlaces);
  }

  async load() {
    if (this.contract) {
      return this.contract;
    }

    const { address } = this.strategy;

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

  async oracleURL() {
    const { oracleURL } = await this.load();

    return oracleURL;
  }

  async tokenAddresses() {
    const { longPositionTokenAddress, shortPositionTokenAddress } = await this.load();

    return {
      longAddress: longPositionTokenAddress.toLowerCase(),
      shortAddress: shortPositionTokenAddress.toLowerCase(),
    };
  }
}

export default MarketContractWrapper;
